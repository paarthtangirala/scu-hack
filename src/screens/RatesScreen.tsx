import React, { useState, useEffect } from 'react';
import { 
  Clock, Info, TrendingUp, TrendingDown, Minus, BarChart3, ArrowUpRight, ShieldCheck,
  Package, Cylinder, Droplets, FlaskConical, GlassWater, Cable, Layers, Cpu, Monitor, Weight, Newspaper, Boxes
} from 'lucide-react';
import { MATERIAL_RATES } from '../types';
import { motion } from 'motion/react';
import { StateView } from '../components/StateView';

const MATERIAL_ICONS: Record<string, { icon: any, color: string, bg: string }> = {
  'cardboard': { icon: Package, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  'aluminum': { icon: Cylinder, color: 'text-primary', bg: 'bg-primary/10' },
  'pet': { icon: Droplets, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  'hdpe': { icon: FlaskConical, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  'glass': { icon: GlassWater, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  'copper': { icon: Cable, color: 'text-orange-400', bg: 'bg-orange-400/10' },
  'scrap-al': { icon: Layers, color: 'text-slate-400', bg: 'bg-slate-400/10' },
  'ewaste-noncrt': { icon: Cpu, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
  'ewaste-crt': { icon: Monitor, color: 'text-violet-400', bg: 'bg-violet-400/10' },
  'steel': { icon: Weight, color: 'text-zinc-400', bg: 'bg-zinc-400/10' },
  'newspaper': { icon: Newspaper, color: 'text-stone-400', bg: 'bg-stone-400/10' },
  'mixed-metal': { icon: Boxes, color: 'text-rose-400', bg: 'bg-rose-400/10' },
};

export const RatesScreen: React.FC = () => {
  const [viewState, setViewState] = useState<'idle' | 'loading' | 'empty' | 'error'>('loading');

  useEffect(() => {
    const timer = setTimeout(() => setViewState('idle'), 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex-grow overflow-y-auto no-scrollbar pb-32">
      <StateView state={viewState}>
        <div className="px-6 pt-12 pb-6 flex justify-between items-end border-b border-white/5 bg-surface/30 backdrop-blur-xl sticky top-0 z-10 shadow-lg">
          <div className="space-y-1.5">
            <h2 className="text-xl font-display font-bold text-main tracking-tight">Material Rates</h2>
            <div className="flex items-center gap-2 text-muted">
              <BarChart3 size={10} className="text-primary" />
              <p className="text-[10px] font-medium">Live payout estimates per lb.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[9px] font-mono font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20 shadow-inner">
            <Clock size={10} /> {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2 px-2 py-0.5">
            <Info size={10} className="text-muted" />
            <p className="text-[8px] font-bold text-muted uppercase tracking-[0.2em]">Market Index: Santa Clara</p>
          </div>

          <div className="space-y-3">
            {MATERIAL_RATES.map((rate, i) => {
              const isUp = i % 3 === 0;
              const isDown = i % 4 === 0;
              const iconData = MATERIAL_ICONS[rate.id] || { icon: Package, color: 'text-primary', bg: 'bg-primary/10' };
              const Icon = iconData.icon;
              
              return (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  key={rate.id} 
                  className="card-native p-4 flex justify-between items-center active:scale-[0.98] transition-all border border-white/5 group shadow-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl ${iconData.bg} flex items-center justify-center ${iconData.color} border border-white/5 group-hover:border-primary/30 transition-all shadow-inner shrink-0`}>
                      <Icon size={24} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-main tracking-tight">{rate.name}</p>
                        {isUp ? <TrendingUp size={10} className="text-primary" /> : isDown ? <TrendingDown size={10} className="text-amber-500" /> : <Minus size={10} className="text-muted" />}
                      </div>
                      <p className="text-[8px] text-muted font-bold uppercase tracking-[0.15em]">Source: {rate.source}</p>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-sm font-mono font-bold text-primary tracking-tight drop-shadow-[0_0_8px_rgba(0,232,122,0.3)]">${rate.rate.toFixed(2)}/lb</p>
                    <div className="flex items-center justify-end gap-1.5">
                      <p className="text-[8px] text-muted font-mono font-medium">10lb: ${(rate.rate * 10).toFixed(2)}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

      <div className="px-6 py-10 space-y-8">
        <div className="p-7 bg-surface/40 backdrop-blur-md rounded-3xl border border-white/5 space-y-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <ShieldCheck size={18} className="text-primary" />
            <h4 className="text-xs font-bold text-main uppercase tracking-[0.2em]">About Rates</h4>
          </div>
          <p className="text-xs text-muted leading-relaxed font-medium">
            Rates are calculated based on current CRV (California Refund Value) and local scrap market indices. Actual payouts may vary based on material purity and contamination levels.
          </p>
        </div>

          <div className="text-center">
            <button className="text-[11px] font-bold text-muted uppercase tracking-[0.2em] hover:text-primary transition-all flex items-center justify-center gap-2 mx-auto group">
              End of Market Data <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </StateView>
    </div>
  );
};
