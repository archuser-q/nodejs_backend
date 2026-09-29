/**
 * Thuật toán ghép cặp (đề cương mục 6.1) — 2 chế độ vận hành:
 *   - instant: Weighted Scoring / Greedy — chấm điểm từng ứng viên, chọn
 *     điểm cao nhất, gửi offer có hạn trả lời (offer_ttl_seconds).
 *   - batch: gom các đơn đang chờ (pending_match) + thợ đang rảnh trong
 *     khu vực thành 1 bài toán gán 2 phía, giải bằng thuật toán Hungarian
 *     (Kuhn–Munkres) để tối đa TỔNG điểm phù hợp toàn cục, dùng lại đúng
 *     hàm chấm điểm của instant làm ma trận chi phí — đúng như đề cương mô
 *     tả ("dùng ma trận chi phí xây từ chính hàm điểm ở chế độ 1").
 *
 * File này KHÔNG phụ thuộc Express/req — nhận thẳng 1 `db` (client/pool có
 * `.query()`) để dễ test độc lập (xem test-matching.js) và để controller
 * gọi lại được bằng đúng connection đang có RLS context của request.
 */

// ---------------------------------------------------------------------
// Toán học cơ bản
// ---------------------------------------------------------------------

/** Khoảng cách Haversine giữa 2 điểm (km). */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Chuẩn hoá khoảng cách về [0,1] — càng gần điểm càng cao, ngoài bán kính hoạt động thì 0. */
function distanceScore(distanceKm, radiusKm) {
  if (radiusKm <= 0) return 0;
  return Math.max(0, 1 - distanceKm / radiusKm);
}

/** Tải công việc hiện tại — càng ít đơn đang xử lý điểm càng cao (1 khi rảnh hẳn). */
function workloadScore(activeOrderCount) {
  return 1 / (1 + activeOrderCount);
}

/**
 * Điểm Weighted Scoring cho 1 ứng viên — đúng 4 tiêu chí đề cương mục 6.1
 * (khoảng cách, trust score, tỷ lệ hoàn thành, tải công việc). Phần ⭐ "độ
 * phù hợp kỹ năng" CHƯA làm ở bản này (đánh dấu mở rộng trong đề cương,
 * không bắt buộc cho MVP) — mọi ứng viên đưa vào đây coi như đã qua vòng
 * lọc "có đúng chuyên môn" ở bước truy vấn ứng viên rồi (xem
 * `findCandidates`), nên không cần cộng thêm điểm kỹ năng nữa ở bước này.
 */
function computeScore(candidate, weights) {
  const dScore = distanceScore(candidate.distanceKm, candidate.operatingRadiusKm);
  const tScore = candidate.trustScore / 100;
  const cScore = candidate.completionRate;
  const wScore = workloadScore(candidate.activeOrderCount);
  return (
    weights.weight_distance * dScore +
    weights.weight_trust_score * tScore +
    weights.weight_completion_rate * cScore +
    weights.weight_workload * wScore
  );
}

// ---------------------------------------------------------------------
// Truy vấn ứng viên
// ---------------------------------------------------------------------

/**
 * Tìm thợ CÓ THỂ nhận đơn này: đang online, hồ sơ đã duyệt, có chuyên môn
 * đúng dịch vụ, trong bán kính hoạt động, và CHƯA từ chối/hết hạn offer
 * của chính đơn này trước đó (để không mời lại người đã từ chối).
 * Khoảng cách lọc bằng JS (Haversine) sau khi lấy danh sách thô từ DB —
 * quy mô demo nhỏ nên không cần index không gian (đó là việc của Thành
 * viên C ở tầng khác/quy mô khác).
 */
async function findCandidates(db, order) {
  const { rows } = await db.query(
    `SELECT w.user_id, w.operating_center_latitude, w.operating_center_longitude,
            w.operating_radius_km, w.trust_score, w.completion_rate
       FROM workers w
       JOIN worker_services ws ON ws.worker_user_id = w.user_id
      WHERE w.is_online = true
        AND w.verification = 'approved'
        AND ws.service_id = $1
        AND w.user_id NOT IN (
          SELECT worker_user_id FROM order_offers
           WHERE order_id = $2 AND status IN ('declined', 'expired')
        )`,
    [order.service_id, order.id],
  );

  const candidates = [];
  for (const w of rows) {
    if (w.operating_center_latitude == null || order.latitude == null) continue;
    const distanceKm = haversineKm(order.latitude, order.longitude, w.operating_center_latitude, w.operating_center_longitude);
    if (distanceKm > w.operating_radius_km) continue;

    const { rows: activeRows } = await db.query(
      `SELECT count(*)::int AS n FROM orders WHERE worker_user_id = $1 AND status IN ('accepted', 'in_progress')`,
      [w.user_id],
    );

    candidates.push({
      workerUserId: w.user_id,
      distanceKm,
      operatingRadiusKm: Number(w.operating_radius_km),
      trustScore: w.trust_score,
      completionRate: Number(w.completion_rate),
      activeOrderCount: activeRows[0].n,
    });
  }
  return candidates;
}

async function getWeights(db) {
  const { rows } = await db.query('SELECT * FROM matching_config ORDER BY id DESC LIMIT 1');
  return rows[0] || {
    weight_distance: 0.35, weight_trust_score: 0.35, weight_completion_rate: 0.15, weight_workload: 0.15,
    offer_ttl_seconds: 45,
  };
}

// ---------------------------------------------------------------------
// Chế độ 1 — Instant (Weighted Scoring / Greedy)
// ---------------------------------------------------------------------

/**
 * Chạy ghép cặp tức thời cho 1 đơn: tìm ứng viên, chấm điểm, chọn cao
 * nhất, tạo offer có hạn trả lời. Gọi lại được nhiều lần cho CÙNG 1 đơn
 * (vd: ứng viên trước từ chối/hết hạn) — findCandidates tự loại người đã
 * declined/expired nên lần gọi sau tự động nhắm tới ứng viên tốt tiếp theo.
 * Trả về null nếu không còn ứng viên nào phù hợp.
 */
async function runInstantMatch(db, orderId) {
  const { rows: orderRows } = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = orderRows[0];
  if (!order) throw new Error(`Không tìm thấy đơn #${orderId}`);

  const weights = await getWeights(db);
  const candidates = await findCandidates(db, order);
  if (candidates.length === 0) return null;

  let best = null;
  for (const c of candidates) {
    const score = computeScore(c, weights);
    if (!best || score > best.score) best = { ...c, score };
  }

  await db.query(
    `INSERT INTO order_offers (order_id, worker_user_id, status, score, expires_at)
     VALUES ($1, $2, 'offered', $3, now() + ($4 || ' seconds')::interval)`,
    [orderId, best.workerUserId, best.score, weights.offer_ttl_seconds],
  );
  await db.query(`UPDATE orders SET status = 'offered' WHERE id = $1`, [orderId]);

  return { workerUserId: best.workerUserId, score: best.score };
}

// ---------------------------------------------------------------------
// Chế độ 2 — Batch (Hungarian / Kuhn–Munkres)
// ---------------------------------------------------------------------

/**
 * Thuật toán Hungarian cho bài toán gán 2 phía TỐI ĐA tổng trọng số (bản
 * kinh điển giải bài toán TỐI THIỂU chi phí — ở đây đảo dấu ma trận điểm
 * thành ma trận "chi phí" bằng cách lấy (maxScore - score) để tái dùng
 * đúng thuật toán chuẩn, rồi đảo lại khi đọc kết quả). Độ phức tạp O(n³),
 * đúng như đề cương yêu cầu.
 *
 * costMatrix: mảng 2 chiều n x n (đã đệm 0 cho vuông nếu số đơn ≠ số thợ).
 * Trả về mảng `assignment` độ dài n: assignment[i] = cột được gán cho
 * hàng i (chỉ số cột, không phải id thật — controller tự map lại).
 *
 * Cài đặt theo phiên bản O(n³) chuẩn (dựa trên thế vị/potential + đường đi
 * tăng luồng ngắn nhất), không dùng thư viện ngoài — đúng yêu cầu "tự thiết
 * kế và tự cài đặt" của đề cương.
 */
function solveHungarian(costMatrix) {
  const n = costMatrix.length;
  const INF = Infinity;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0); // p[j] = hàng đang gán cho cột j (1-indexed)
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j] !== 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

/**
 * Chạy ghép cặp theo lô: lấy toàn bộ đơn đang 'pending_match' + toàn bộ
 * ứng viên rảnh (hợp lệ với ÍT NHẤT 1 trong các đơn đó), giải Hungarian để
 * tối đa tổng điểm toàn cục, tạo offer cho từng cặp được gán — thay vì xử
 * lý greedy từng đơn theo thứ tự đến (nhược điểm chế độ 1 mà đề cương nêu).
 * Đơn không được ghép ở lượt này (thiếu thợ, hoặc bị thợ khác "chiếm" vì
 * lợi hơn cho tổng thể) sẽ được xét lại ở lượt chạy tiếp theo.
 */
async function runBatchMatch(db) {
  const weights = await getWeights(db);
  const { rows: orders } = await db.query(`SELECT * FROM orders WHERE status = 'pending_match'`);
  if (orders.length === 0) return { matched: 0, orders: 0, candidates: 0 };

  // Ứng viên cho từng đơn (có thể trùng nhau giữa các đơn).
  const candidatesByOrder = await Promise.all(orders.map((o) => findCandidates(db, o)));
  const workerIds = [...new Set(candidatesByOrder.flat().map((c) => c.workerUserId))];
  if (workerIds.length === 0) return { matched: 0, orders: orders.length, candidates: 0 };

  const n = Math.max(orders.length, workerIds.length);
  // Ma trận điểm thô (0 nếu thợ đó không phải ứng viên hợp lệ của đơn đó).
  const scoreMatrix = orders.map((_, oi) =>
    workerIds.map((wid) => {
      const c = candidatesByOrder[oi].find((cand) => cand.workerUserId === wid);
      return c ? computeScore(c, weights) : 0;
    }),
  );
  // Đệm cho đủ vuông n x n (Hungarian cần ma trận vuông).
  const maxScore = Math.max(1, ...scoreMatrix.flat());
  const costMatrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const raw = i < orders.length && j < workerIds.length ? scoreMatrix[i][j] : 0;
      return maxScore - raw; // đảo điểm thành "chi phí" để dùng đúng thuật toán chuẩn (tối thiểu chi phí)
    }),
  );

  const assignment = solveHungarian(costMatrix);

  let matched = 0;
  for (let oi = 0; oi < orders.length; oi++) {
    const wi = assignment[oi];
    if (wi == null || wi >= workerIds.length) continue; // gán vào cột đệm giả -> không có thợ thật
    const rawScore = scoreMatrix[oi][wi];
    if (rawScore <= 0) continue; // thợ đó thực ra không phải ứng viên hợp lệ của đơn này (bị đệm ép gán)

    const workerUserId = workerIds[wi];
    await db.query(
      `INSERT INTO order_offers (order_id, worker_user_id, status, score, expires_at)
       VALUES ($1, $2, 'offered', $3, now() + ($4 || ' seconds')::interval)`,
      [orders[oi].id, workerUserId, rawScore, weights.offer_ttl_seconds],
    );
    await db.query(`UPDATE orders SET status = 'offered' WHERE id = $1`, [orders[oi].id]);
    matched += 1;
  }

  return { matched, orders: orders.length, candidates: workerIds.length };
}

module.exports = {
  haversineKm,
  distanceScore,
  workloadScore,
  computeScore,
  findCandidates,
  runInstantMatch,
  solveHungarian,
  runBatchMatch,
};
