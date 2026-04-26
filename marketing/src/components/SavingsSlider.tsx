import { useState } from 'react';
import { motion } from 'framer-motion';

export default function SavingsSlider() {
  const [gb, setGb] = useState(500);
  const sf = gb * 5;
  const vf = gb * 0.023;
  const saved = sf - vf;
  const pct = Math.round((saved / Math.max(sf, 1)) * 100);
  const min = 10, max = 5000;
  const pctPos = ((gb - min) / (max - min)) * 100;
  return (
    <section className="relative border-y border-slate-900 bg-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-20">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.6 }} className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">Savings calculator</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-[-0.02em] text-white">Move the slider. Watch Salesforce sweat.</h2>
          <p className="mt-4 text-slate-400 text-lg">
            Salesforce rate: <span className="font-mono text-slate-200">$5/GB/mo</span>. Vastify on S3 Standard: <span className="font-mono text-slate-200">$0.023/GB/mo</span>.
          </p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.7, delay: 0.1 }}
          className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-8 md:p-10">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Your Salesforce storage</div>
              <div className="font-mono text-4xl font-semibold text-white mt-1">{gb.toLocaleString()} <span className="text-slate-500 text-2xl">GB</span></div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-400">You save</div>
              <div className="font-mono text-4xl font-semibold text-emerald-300 mt-1">
                ${Math.round(saved).toLocaleString()}<span className="text-slate-500 text-lg">/mo</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">{pct}% cheaper</div>
            </div>
          </div>
          <input type="range" min={min} max={max} step={10} value={gb}
            onChange={(e) => setGb(Number(e.target.value))}
            className="vast-range" style={{ ['--pct' as any]: `${pctPos}%` }} />
          <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-2">
            <span>10 GB</span><span>1 TB</span><span>5 TB</span>
          </div>
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-500/80" /> Salesforce storage
              </div>
              <div className="mt-3 font-mono text-3xl md:text-4xl text-slate-200">
                ${Math.round(sf).toLocaleString()}<span className="text-slate-500 text-base">/mo</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">${(sf*12).toLocaleString()} per year</div>
              <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-rose-500 to-rose-400" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="rounded-xl border border-brand-600/30 bg-gradient-to-br from-brand-600/10 to-slate-950/50 p-5 relative overflow-hidden">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" /> Vastify on S3 Standard
              </div>
              <div className="mt-3 font-mono text-3xl md:text-4xl text-white">
                ${vf.toFixed(2)}<span className="text-slate-500 text-base">/mo</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">${(vf*12).toFixed(2)} per year</div>
              <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-brand-500 to-brand-300"
                  animate={{ width: `${(vf/sf)*100}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
