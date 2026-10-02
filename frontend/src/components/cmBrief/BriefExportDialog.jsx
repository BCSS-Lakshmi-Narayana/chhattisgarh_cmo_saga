/**
 * BriefExportDialog — choose a window, a leader and a handle scope, export.
 *
 * Replaces the old Export button, which called `window.print()` and printed
 * the SCREEN: current scroll position, sidebar and all, for whichever window
 * happened to be loaded.
 *
 * ── THREE AXES, EACH A REAL QUESTION ─────────────────────────────────
 *   window   one report, or one per day — "1–7 Oct" as a single report
 *            averages the week and hides that Tuesday was the bad day.
 *   leader   who the report is about.
 *   handles  combined, or one report per source handle.
 *
 * ── DELIVERY NEVER DEPENDS ON POPUPS ─────────────────────────────────
 * A per-handle export opens one document per handle, and browsers block
 * every window after the first in a gesture. "Download files" is therefore
 * the default for multi-document exports: it always works, needs no
 * permission, and leaves files the user can keep.
 */
import React, { useMemo, useState } from 'react';
import { Download, X, CalendarDays, User, AtSign, Loader2, FileText } from 'lucide-react';
import api from '../../lib/api';
import { openBriefReport, downloadBriefReport } from '../../lib/briefReport';

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

const eachDay = (from, to) => {
    const out = [];
    const cur = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cur <= end && out.length < 62) {
        out.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
};

// A function DECLARATION, not an arrow const. Two components in one
// module is fine for Fast Refresh, but a hoisted declaration keeps a stable
// identity across hot updates — an anonymous arrow can lose its refresh
// signature mid-session and throw "_s is not a function".
function Field({ icon: Icon, label, children, hint }) {
    return (
        <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" /> {label}
            </div>
            {children}
            {hint && <p className="text-[11px] text-slate-500 mt-1.5">{hint}</p>}
        </div>
    );
}

export default function BriefExportDialog({
    open, onClose, leaders = [], handles = [], appName, stateName,
}) {
    const [mode, setMode] = useState('range');        // range | daily
    const [handleMode, setHandleMode] = useState('all'); // all | one | each
    const [handle, setHandle] = useState('');
    const [from, setFrom] = useState(daysAgoStr(7));
    const [to, setTo] = useState(todayStr());
    const [leaderMode, setLeaderMode] = useState('all'); // all | one | each
    const [leader, setLeader] = useState('');
    const [delivery, setDelivery] = useState('open');  // open | download
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [progress, setProgress] = useState(null);

    // Only handles that actually posted enough to make a report worth reading.
    const usableHandles = useMemo(
        () => handles.filter((h) => h.count >= 2).slice(0, 50), [handles],
    );

    /**
     * EVERY leader gets a report, including the ones with nothing this week.
     *
     * Not `leaders.filter((l) => l.mentions)` — the client asked for one
     * report per profile, and a quiet leader is exactly the one someone will
     * ask about. The backend unions the roster in at zero for the same
     * reason; filtering here would undo that.
     */
    const exportLeaders = useMemo(() => leaders.map((l) => l.name).filter(Boolean), [leaders]);

    const jobCount = useMemo(() => {
        const days = mode === 'daily' && from && to && to >= from ? eachDay(from, to).length : 1;
        const hs = handleMode === 'each' ? Math.max(1, usableHandles.length) : 1;
        const ls = leaderMode === 'each' ? Math.max(1, exportLeaders.length) : 1;
        return days * hs * ls;
    }, [mode, from, to, handleMode, usableHandles, leaderMode, exportLeaders]);

    if (!open) return null;

    const fetchBrief = async (f, t, h, who) => {
        const q = new URLSearchParams({ from: f, to: t });
        if (who) q.set('leader', who);
        if (h) q.set('handle', h);
        const r = await api.get(`/cm-dashboard/brief?${q.toString()}`);
        return r.data;
    };

    const deliver = async (data) => {
        const opts = { appName, stateName };
        // Many documents always download: opening 30 tabs is blocked, and 30
        // print dialogs in a row is not usable either.
        if (delivery === 'download' || jobCount > 3) { downloadBriefReport(data, opts); return; }
        await openBriefReport(data, opts);
    };

    const run = async () => {
        setErr(null);
        if (!from || !to || to < from) { setErr('Pick an end date on or after the start date.'); return; }
        if (handleMode === 'one' && !handle) { setErr('Pick a handle, or choose "All handles".'); return; }
        if (leaderMode === 'one' && !leader) { setErr('Pick a leader, or choose "Combined".'); return; }
        if (leaderMode === 'each' && !exportLeaders.length) { setErr('No leaders to report on yet.'); return; }

        setBusy(true);
        try {
            const days = mode === 'daily' ? eachDay(from, to) : [[from, to]];
            const hs = handleMode === 'each'
                ? usableHandles.map((h) => h.handle)
                : [handleMode === 'one' ? handle : null];
            const ls = leaderMode === 'each'
                ? exportLeaders
                : [leaderMode === 'one' ? leader : null];

            let i = 0;
            for (const d of days) {
                const [f, t] = Array.isArray(d) ? d : [d, d];
                for (const h of hs) {
                    for (const who of ls) {
                        i += 1;
                        setProgress(`${i} of ${jobCount}${who ? ` — ${who}` : ''}`);
                        // Sequential on purpose — each job is a full brief query.
                        // eslint-disable-next-line no-await-in-loop
                        const data = await fetchBrief(f, t, h, who);
                        // eslint-disable-next-line no-await-in-loop
                        await deliver(data);
                    }
                }
            }
            onClose();
        } catch (e) {
            setErr(e?.response?.data?.message || e.message);
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    const seg = (value, current, set, label) => (
        <button key={value} onClick={() => set(value)} disabled={busy}
            className={`flex-1 px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors ${
                current === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
            {label}
        </button>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-auto">

                <div className="flex items-start justify-between p-5 pb-3 sticky top-0 bg-white">
                    <div>
                        <h2 className="text-[16px] font-bold text-slate-900">Export brief</h2>
                        <p className="text-[12px] text-slate-500 mt-0.5">
                            {jobCount === 1 ? 'One report' : `${jobCount} reports`}
                        </p>
                    </div>
                    <button onClick={onClose} disabled={busy}
                        className="text-slate-400 hover:text-slate-600 disabled:opacity-40">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="px-5 pb-5 space-y-4">

                    <Field icon={FileText} label="Period"
                        hint={mode === 'range'
                            ? 'A single report covering the whole window.'
                            : 'One report per day — so a bad Tuesday is visible, not averaged away.'}>
                        <div className="flex bg-slate-100 rounded-lg p-0.5">
                            {seg('range', mode, setMode, 'One report')}
                            {seg('daily', mode, setMode, 'Day by day')}
                        </div>
                    </Field>

                    <Field icon={CalendarDays} label="Dates">
                        <div className="flex items-center gap-2">
                            <input type="date" value={from} max={to} disabled={busy}
                                onChange={(e) => setFrom(e.target.value)}
                                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-[13px]" />
                            <span className="text-slate-400 text-[12px]">to</span>
                            <input type="date" value={to} min={from} max={todayStr()} disabled={busy}
                                onChange={(e) => setTo(e.target.value)}
                                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-[13px]" />
                        </div>
                        <div className="flex gap-1.5 mt-2">
                            {[['Today', 0], ['7d', 6], ['30d', 29]].map(([label, d]) => (
                                <button key={label} disabled={busy}
                                    onClick={() => { setFrom(daysAgoStr(d)); setTo(todayStr()); }}
                                    className="px-2.5 py-1 rounded-md border border-slate-200 text-[11.5px] text-slate-600 hover:bg-slate-50">
                                    {label}
                                </button>
                            ))}
                        </div>
                    </Field>

                    <Field icon={AtSign} label="Source handles"
                        hint={handleMode === 'each'
                            ? `A separate report for each of ${usableHandles.length} handles.`
                            : handleMode === 'one' ? 'One report, only this handle’s posts.'
                                : 'Everything in the window, combined.'}>
                        <div className="flex bg-slate-100 rounded-lg p-0.5 mb-2">
                            {seg('all', handleMode, setHandleMode, 'Combined')}
                            {seg('one', handleMode, setHandleMode, 'One handle')}
                            {seg('each', handleMode, setHandleMode, 'Each separately')}
                        </div>
                        {handleMode === 'one' && (
                            <select value={handle} onChange={(e) => setHandle(e.target.value)} disabled={busy}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white">
                                <option value="">Select a handle…</option>
                                {usableHandles.map((h) => (
                                    <option key={h.handle} value={h.handle}>@{h.handle} — {h.count} posts</option>
                                ))}
                            </select>
                        )}
                    </Field>

                    <Field icon={User} label="Leader"
                        hint={leaders.length === 0 ? 'No leaders named in this window yet.'
                            : leaderMode === 'each'
                                ? `A separate report for each of ${exportLeaders.length} leaders, `
                                  + 'including any with no mentions this window.'
                                : leaderMode === 'one' ? 'One report, only this leader.'
                                    : 'One report covering every leader together.'}>
                        <div className="flex bg-slate-100 rounded-lg p-0.5 mb-2">
                            {seg('all', leaderMode, setLeaderMode, 'Combined')}
                            {seg('one', leaderMode, setLeaderMode, 'One leader')}
                            {seg('each', leaderMode, setLeaderMode, 'Each separately')}
                        </div>
                        {leaderMode === 'one' && (
                            <select value={leader} onChange={(e) => setLeader(e.target.value)} disabled={busy}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white">
                                <option value="">Select a leader…</option>
                                {leaders.map((l) => (
                                    <option key={l.name} value={l.name}>
                                        {l.name}{l.mentions ? ` — ${l.mentions} mentions` : ' — no mentions'}
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>

                    <Field icon={Download} label="Deliver as"
                        hint={jobCount > 3
                            ? 'More than three reports always download — browsers block repeated tabs.'
                            : null}>
                        <div className="flex bg-slate-100 rounded-lg p-0.5">
                            {seg('open', delivery, setDelivery, 'Open & print')}
                            {seg('download', delivery, setDelivery, 'Download files')}
                        </div>
                    </Field>

                    {err && (
                        <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                            {err}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <button onClick={onClose} disabled={busy}
                            className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                            Cancel
                        </button>
                        <button onClick={run} disabled={busy || !from || !to || to < from}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-50">
                            {busy
                                ? <><Loader2 className="h-4 w-4 animate-spin" /> {progress || 'Building…'}</>
                                : <><Download className="h-4 w-4" /> Export {jobCount > 1 ? jobCount : ''}</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
