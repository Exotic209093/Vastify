import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const setupSteps = [
  { tool: 'introspect_org',     desc: 'Reading 2,481 ContentVersion rows…' },
  { tool: 'pick_backend',       desc: 'Recommending GCS · eu-west2 (data residency: UK)' },
  { tool: 'write_storage_config', desc: 'Wrote tenants/acme/storage.json' },
  { tool: 'generate_starter_rules', desc: 'Created 4 routing rules · ContentVersion > 1MB → offload' },
  { tool: 'validate_connection', desc: 'Round-trip OK · 184 ms' },
];

export default function AIShowcase() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % (setupSteps.length + 1)), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <section id="ai-showcase" className="relative">
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">Built with Claude Opus</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-[-0.02em] text-white">Onboarding that finishes itself.</h2>
          <p className="mt-4 text-slate-400 text-lg">Two AI features that turn the boring parts of CRM storage into one click.</p>
        </div>
        <div className="mt-12 grid lg:grid-cols-2 gap-6">
          {/* Setup Agent */}
          <div className="shimmer-wrap p-[1px]">
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-brand-300 uppercase tracking-wider">Headline feature</div>
                  <h3 className="mt-1 text-xl font-semibold text-white">Setup Agent</h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">LIVE</span>
              </div>
              <p className="mt-3 text-sm text-slate-400">Inspects your org, picks the right backend, writes a starter ruleset, and validates the connection — all in one click.</p>
              <div className="mt-5 rounded-lg bg-slate-950 border border-slate-800 p-4 font-mono text-[11px] min-h-[180px]">
                {setupSteps.slice(0, i).map((s, idx) => (
                  <motion.div key={idx} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3 py-1">
                    <span className="text-emerald-400">✓</span>
                    <span><span className="text-brand-300">{s.tool}</span> <span className="text-slate-500">·</span> <span className="text-slate-300">{s.desc}</span></span>
                  </motion.div>
                ))}
                {i < setupSteps.length && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 py-1">
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="text-brand-300">●</motion.span>
                    <span className="text-slate-400">{setupSteps[i]?.tool ?? 'done'}</span>
                  </motion.div>
                )}
              </div>
              <a href="/ai" className="mt-5 inline-block text-sm text-brand-300 hover:text-brand-100">Read more →</a>
            </div>
          </div>
          {/* Diff Explainer */}
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-brand-300 uppercase tracking-wider">Backups</div>
                <h3 className="mt-1 text-xl font-semibold text-white">Diff Explainer</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">LIVE</span>
            </div>
            <p className="mt-3 text-sm text-slate-400">Reads a snapshot diff and tells you in plain English what would change — and which restores are safe to run.</p>
            <div className="mt-5 rounded-lg bg-slate-950 border border-slate-800 p-4 text-[12px] min-h-[180px] text-slate-300 leading-relaxed">
              <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Plain-English summary</div>
              <p>This restore would change <span className="text-white">12 records</span> in <span className="font-mono text-brand-300">Account</span> and re-create <span className="text-white">3 ContentVersion</span> blobs. <span className="text-emerald-300">9 of the 12 record changes are safe to apply.</span> The remaining 3 conflict with edits made after the snapshot — review them before restoring.</p>
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                Restore the 9 safe items
              </div>
            </div>
            <a href="/ai" className="mt-5 inline-block text-sm text-brand-300 hover:text-brand-100">Read more →</a>
          </div>
        </div>
      </div>
    </section>
  );
}
