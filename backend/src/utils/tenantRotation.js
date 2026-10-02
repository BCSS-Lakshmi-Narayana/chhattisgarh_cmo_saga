/**
 * tenantRotation — no tenant waits behind another's backlog.
 *
 * ── THE FAILURE THIS PREVENTS ────────────────────────────────────────
 * Every background queue in this app reads a collection and walks it in
 * INSERTION order. Chhattisgarh was set up first, so its rows come first
 * in every one of them. While there was one client that cost nothing.
 *
 * With two, it starves the newer one. Measured on 2026-10-02:
 *
 *   276 active keywords, the first Maharashtra one at position 55.
 *   At ~9 minutes each that is eight hours before Maharashtra is
 *   touched at all, and a full pass takes about 41 hours — while the
 *   scheduler's own `running` guard blocks the next tick until the
 *   current one finishes.
 *
 * The visible result: Maharashtra grievances went 220 minutes with
 * nothing collected while Chhattisgarh took 124 in the last hour alone.
 * Nothing errored and no alert fired, because nothing was broken — the
 * queue simply never got there.
 *
 * ── WHAT ROUND-ROBIN CHANGES ─────────────────────────────────────────
 * Dealing one row from each tenant in turn makes the wait depend on how
 * many TENANTS there are, not on how many rows the tenant ahead happens
 * to hold. Chhattisgarh having 54 keywords or 5,000 stops mattering to
 * Maharashtra, and a third client added later inherits the same fairness
 * without anyone remembering to think about it.
 *
 * Order within a tenant is preserved, and every row is returned exactly
 * once — this reorders work, it never drops or duplicates it.
 */

/**
 * @param {Array<{vertical?: string}>} rows
 * @param {string} [label] printed with the mix, for the scheduler logs
 * @returns {Array} the same rows, dealt one tenant at a time
 */
const interleaveByVertical = (rows, label = '') => {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length < 2) return list;

    const byVertical = new Map();
    for (const row of list) {
        const v = (row && row.vertical) || 'unknown';
        if (!byVertical.has(v)) byVertical.set(v, []);
        byVertical.get(v).push(row);
    }
    // One tenant means there is nothing to be fair about.
    if (byVertical.size < 2) return list;

    const queues = [...byVertical.values()];
    const mixed = [];
    for (let i = 0; mixed.length < list.length; i += 1) {
        for (const q of queues) if (q[i]) mixed.push(q[i]);
    }

    if (label) {
        console.log(`[Rotation] ${label}: `
            + `${[...byVertical.entries()].map(([v, q]) => `${v}:${q.length}`).join(' ')} `
            + '— dealt round-robin so no tenant waits behind another');
    }
    return mixed;
};

module.exports = { interleaveByVertical };
