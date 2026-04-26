import { motion } from 'framer-motion';

const bars = [32, 58, 44, 71, 39, 82, 65, 90, 55, 74, 48, 86];

export default function DashMockup() {
  return (
    <div className="relative rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl overflow-hidden backdrop-blur-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/80">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
        </div>
        <div className="ml-4 text-[11px] font-mono text-slate-500">app.vastify.io / overview</div>
      </div>
      <div className="grid grid-cols-[130px_1fr]">
        <div className="border-r border-slate-800 p-3 space-y-1 text-[11px]">
          {['Overview','Files','Records','Rules','Backups','Settings'].map((i, idx) => (
            <div key={i} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${idx===0 ? 'bg-brand-600/20 text-brand-50 border border-brand-600/30' : 'text-slate-400'}`}>
              <span className="w-1.5 h-1.5 rounded-sm bg-current opacity-60" />
              {i}
            </div>
          ))}
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-800 bg-gradient-to-br from-brand-600/20 to-slate-900/50 p-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-400">Saved / mo</div>
              <div className="font-mono text-lg font-semibold text-emerald-300 mt-0.5">$2,847</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-400">Files</div>
              <div className="font-mono text-lg font-semibold mt-0.5">184,312</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-400">Records</div>
              <div className="font-mono text-lg font-semibold mt-0.5">2.4M</div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 h-[142px]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-slate-400">Offload throughput · last 24h</div>
              <div className="text-[10px] font-mono text-brand-300">+18.4%</div>
            </div>
            <div className="flex items-end gap-1 h-[96px]">
              {bars.map((h, i) => (
                <motion.div key={`bar-${i}`}
                  initial={{ height: 0 }} animate={{ height: `${h}%` }}
                  transition={{ delay: 0.3 + i*0.04, duration: 0.6, ease: 'easeOut' }}
                  className="flex-1 rounded-t-[3px] bg-gradient-to-t from-brand-700 to-brand-400" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
