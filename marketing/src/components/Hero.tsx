import { useEffect } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import DashMockup from './DashMockup';
import AnimatedCounter from './AnimatedCounter';
import { SITE } from '../lib/site';

export default function Hero() {
  const floatY = useMotionValue(0);
  useEffect(() => {
    const ctrl = animate(floatY, [0, -14, 0], { duration: 6, repeat: Infinity, ease: 'easeInOut' });
    return () => ctrl.stop();
  }, []);
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-brand-600/15 blur-3xl pointer-events-none" />
      <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center relative">
        <div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-300 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Open source · self-hostable
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.05 }}
            className="text-5xl md:text-6xl lg:text-7xl font-semibold tracking-[-0.03em] text-white leading-[0.98]">
            Stop paying Salesforce<br/>storage prices.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="mt-6 text-lg md:text-xl text-slate-400 max-w-xl">
            Vastify offloads your CRM files and records to your own S3 or GCS bucket — at a fraction of the cost. The Setup Agent reads your org, picks the backend, and writes your routing rules. You watch.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
            className="mt-8 flex flex-wrap gap-3">
            <a href="#ai-showcase" className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-3 transition shadow-[0_8px_30px_rgba(37,99,235,0.35)]">Watch the Setup Agent</a>
            <a href={SITE.dashboardUrl} className="rounded-lg border border-slate-700 hover:border-slate-600 hover:bg-slate-900/60 text-slate-200 font-medium px-5 py-3 transition">Try the demo →</a>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }}
            className="mt-10 rounded-xl border border-slate-800 bg-slate-900/60 p-5 max-w-md">
            <div className="text-xs uppercase tracking-wider text-slate-400">Cost per TB of files, per year</div>
            <div className="mt-2 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Salesforce</div>
                <AnimatedCounter to={61440} duration={2} prefix="$" className="font-mono text-3xl font-semibold text-rose-300" />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Vastify on S3</div>
                <AnimatedCounter to={283} duration={2} prefix="$" className="font-mono text-3xl font-semibold text-emerald-300" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">Salesforce list: $5/GB/mo · S3 Standard: $0.023/GB/mo</div>
          </motion.div>
        </div>
        <motion.div key="hero-visual" initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16,1,0.3,1] }} className="relative">
          <div key="glow" className="hero-glow" />
          <motion.div key="mockup" style={{ y: floatY }} className="relative z-10"><DashMockup /></motion.div>
          <motion.div key="pill1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
            className="absolute -left-6 top-10 rounded-lg border border-slate-800 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs shadow-xl z-20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-slate-300">Account.pdf → s3://vastify/…</span>
            </div>
          </motion.div>
          <motion.div key="pill2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }}
            className="absolute -right-4 bottom-8 rounded-lg border border-slate-800 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs shadow-xl z-20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand-300" />
              <span className="font-mono text-slate-300">Setup Agent · 4 tools called</span>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
