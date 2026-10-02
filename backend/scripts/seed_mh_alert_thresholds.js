#!/usr/bin/env node
/**
 * seed_mh_alert_thresholds.js
 * ─────────────────────────────────────────────────────────────────────
 * Gives Maharashtra its own velocity-alert thresholds.
 *
 * ── WHY MAHARASHTRA HAD NONE ─────────────────────────────────────────
 * `velocityAlertService.seedDefaultThresholds()` seeds three rows at
 * startup, but guards on `countDocuments() > 0`. That runs with no request
 * context, so it sees Chhattisgarh's three, decides the job is done, and
 * returns. Maharashtra ends up with zero rows — and `checkVelocity` does:
 *
 *     const threshold = await AlertThreshold.findOne({ platform, is_active });
 *     if (!threshold) return null;
 *
 * so every velocity check for Maharashtra returned null and no viral alert
 * was ever raised. Nothing errored; the feature was simply off.
 *
 * ── WHY NOT MAKE THEM SHARED LIKE PolicyMapping ──────────────────────
 * Because these describe the CLIENT, not the world. A legal section is the
 * same in both states; "1000 likes in an hour is high risk" is a judgement
 * about one client's normal volume, and Maharashtra's is not Chhattisgarh's.
 * Shared reference data gets `{ shared: true }`; client config gets its own
 * rows. See utils/verticalScope.js.
 *
 * The values below are the same defaults the service ships with. Tune them
 * once there is a week of Maharashtra volume to compare against.
 *
 *   node backend/scripts/seed_mh_alert_thresholds.js --dry-run
 *   node backend/scripts/seed_mh_alert_thresholds.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERTICAL = 'mh';

const DEFAULTS = [
    { platform: 'x', low_threshold: 100, medium_threshold: 500, high_threshold: 1000, time_window_minutes: 60 },
    { platform: 'youtube', low_threshold: 100, medium_threshold: 500, high_threshold: 1000, time_window_minutes: 60 },
    { platform: 'facebook', low_threshold: 100, medium_threshold: 500, high_threshold: 1000, time_window_minutes: 60 },
];

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Vertical: ${VERTICAL}${DRY_RUN ? '   (DRY RUN)' : ''}\n`);

    const AlertThreshold = require('../src/models/AlertThreshold');

    await runWithVerticals([VERTICAL], async () => {
        let added = 0; let existing = 0;
        for (const d of DEFAULTS) {
            const found = await AlertThreshold.findOne({ platform: d.platform }).lean();
            if (found) {
                existing += 1;
                console.log(`  = ${d.platform.padEnd(10)} already present`);
                continue;
            }
            if (!DRY_RUN) {
                await AlertThreshold.create({ ...d, is_active: true, vertical: VERTICAL });
            }
            added += 1;
            console.log(`  + ${d.platform.padEnd(10)} low ${d.low_threshold} / `
                + `medium ${d.medium_threshold} / high ${d.high_threshold} `
                + `per ${d.time_window_minutes} min`);
        }
        console.log(`\n  ${added} added, ${existing} already present`);
        const n = await AlertThreshold.countDocuments({});
        console.log(`  ${n} thresholds now visible to ${VERTICAL}\n`);
        console.log(DRY_RUN
            ? 'DRY RUN — nothing written. Re-run without --dry-run to apply.'
            : 'Done. Velocity alerts will now fire for Maharashtra.');
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
