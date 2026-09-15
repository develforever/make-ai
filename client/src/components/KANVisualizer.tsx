import React, { useState, useEffect } from 'react';
import { Cpu, Network, Zap, RefreshCw, BarChart2, CheckCircle2 } from 'lucide-react';
import type { KANTelemetry } from '../types';
import { api } from '../api/client';

interface KANVisualizerProps {
  telemetry?: KANTelemetry | null;
}

export const KANVisualizer: React.FC<KANVisualizerProps> = ({ telemetry: initialTelemetry }) => {
  const [data, setData] = useState<KANTelemetry | null>(initialTelemetry || null);
  const [selectedExpertIndex, setSelectedExpertIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(!initialTelemetry);

  const fetchTelemetry = async () => {
    setIsLoading(true);
    try {
      const res = await api.getKANTelemetry();
      if (res) setData(res);
    } catch (err) {
      console.error('Błąd pobierania telemetrii KAN:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!initialTelemetry) {
      fetchTelemetry();
    }
  }, [initialTelemetry]);

  const activeSpline = data?.spline_profiles?.[selectedExpertIndex] || data?.spline_profiles?.[0];

  // Helper to render SVG spline curve
  const renderSplineSVG = () => {
    if (!activeSpline || !activeSpline.x || activeSpline.x.length === 0) return null;

    const width = 600;
    const height = 260;
    const padding = 40;

    const xMin = Math.min(...activeSpline.x);
    const xMax = Math.max(...activeSpline.x);
    const yMin = Math.min(...activeSpline.y, -0.2);
    const yMax = Math.max(...activeSpline.y, 0.2);

    const scaleX = (val: number) => padding + ((val - xMin) / (xMax - xMin || 1)) * (width - 2 * padding);
    const scaleY = (val: number) => height - padding - ((val - yMin) / (yMax - yMin || 1)) * (height - 2 * padding);

    const points = activeSpline.x
      .map((xVal, idx) => `${scaleX(xVal)},${scaleY(activeSpline.y[idx])}`)
      .join(' ');

    const zeroY = scaleY(0);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64 bg-slate-950/80 rounded-xl border border-slate-800">
        {/* Grid lines */}
        <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="#334155" strokeDasharray="4 4" strokeWidth="1" />
        <line x1={scaleX(0)} y1={padding} x2={scaleX(0)} y2={height - padding} stroke="#334155" strokeDasharray="4 4" strokeWidth="1" />

        {/* Spline curve */}
        <polyline
          fill="none"
          stroke="#06b6d4"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {/* Point nodes */}
        {activeSpline.x.filter((_, i) => i % 5 === 0).map((xVal, idx) => {
          const originalIdx = idx * 5;
          const px = scaleX(xVal);
          const py = scaleY(activeSpline.y[originalIdx]);
          return (
            <circle key={idx} cx={px} cy={py} r="4" fill="#a855f7" stroke="#ffffff" strokeWidth="1.5" />
          );
        })}

        {/* Axis Labels */}
        <text x={padding} y={height - 12} fill="#64748b" fontSize="11" fontFamily="monospace">x = -1.0</text>
        <text x={width - padding - 40} y={height - 12} fill="#64748b" fontSize="11" fontFamily="monospace">x = +1.0</text>
        <text x={10} y={padding + 10} fill="#64748b" fontSize="11" fontFamily="monospace">y = {yMax.toFixed(2)}</text>
        <text x={10} y={height - padding} fill="#64748b" fontSize="11" fontFamily="monospace">y = {yMin.toFixed(2)}</text>
      </svg>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur">
        <div className="absolute -top-12 -right-12 w-64 h-64 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
                <Cpu className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Laboratorium Kognitywne: Sieć KAN (Kolmogorov-Arnold Network)
              </h2>
            </div>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Nieliniowa architektura krawędziowa z adaptacyjnymi splajnami B-spline, topologicznym routingiem SOM (Mixture of Experts) oraz ochroną pamięci składniowej metodą EWC (Elastic Weight Consolidation).
            </p>
          </div>

          <button
            onClick={fetchTelemetry}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors shadow"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Odśwież Wagi</span>
          </button>
        </div>

        {/* 4 Metric Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-xs text-slate-400 block font-medium">Parametry B-Spline</span>
            <span className="text-xl font-bold text-cyan-400 font-mono mt-1 block">
              {data?.model_summary?.kan_spline_parameters?.toLocaleString() || '696,320'}
            </span>
            <span className="text-[11px] text-cyan-600 mt-0.5 block font-mono">95.1% całkowitej wagi modelu</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-xs text-slate-400 block font-medium">Funkcja Aktywacji</span>
            <span className="text-xl font-bold text-purple-400 font-mono mt-1 block">
              Mish + B-Spline
            </span>
            <span className="text-[11px] text-purple-500 mt-0.5 block font-mono">Rząd splajnu: k = 3 (Cubic)</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-xs text-slate-400 block font-medium">Routing Topologiczny</span>
            <span className="text-xl font-bold text-emerald-400 font-mono mt-1 block">
              SOM Top-2 MoE
            </span>
            <span className="text-[11px] text-emerald-600 mt-0.5 block font-mono">4 mikro-ekspertów KAN</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span className="text-xs text-slate-400 block font-medium">Pamięć Ciągła (EWC)</span>
            <span className="text-xl font-bold text-amber-400 font-mono mt-1 block">
              Fisher Active
            </span>
            <span className="text-[11px] text-amber-500 mt-0.5 block font-mono">Sztywność wag: λ = 200.0</span>
          </div>
        </div>
      </div>

      {/* Main Interactive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Interactive B-Spline Curve Viewer */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                Uczące się Nieliniowości KAN (B-Splines on Edges)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Krzywa aktywacji $\phi_{'{'}i,j{'}'}(x)$ wyliczona na węzłach splajnów dla wybranego eksperta.
              </p>
            </div>

            {/* Expert Selector */}
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {data?.spline_profiles?.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedExpertIndex(idx)}
                  className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                    selectedExpertIndex === idx
                      ? 'bg-cyan-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {typeof p.expert_id === 'number' ? `Ekspert #${p.expert_id + 1}` : 'Agregator'}
                </button>
              )) || (
                <span className="text-xs text-slate-500 px-2 py-1">Ładowanie splajnów...</span>
              )}
            </div>
          </div>

          {/* SVG Canvas Plot */}
          {renderSplineSVG()}

          <div className="flex items-center justify-between text-xs text-slate-400 pt-1 font-mono">
            <span>Siatka bazowa (Grid): {activeSpline?.grid_size ?? 5} przedziałów węzłowych</span>
            <span className="text-cyan-400">Warstwa wejściowa: {activeSpline?.in_features ?? 64} wymiarów</span>
          </div>
        </div>

        {/* Right Col: SOM Router & EWC Telemetry */}
        <div className="space-y-6">
          {/* SOM Topological Grid */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-3">
            <h3 className="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <Network className="w-4 h-4 text-emerald-400" />
              Siatka Topologiczna SOM
            </h3>
            <p className="text-xs text-slate-400">
              Prototypy wektorowe $w_k$ w 2-wymiarowej przestrzeni rzutowania:
            </p>

            <div className="space-y-2 pt-1">
              {data?.som_topological_map?.map((som) => (
                <div
                  key={som.expert_id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-slate-200 font-semibold">{som.name}</span>
                  </div>
                  <div className="text-slate-400 flex items-center gap-3">
                    <span>x: {som.x.toFixed(3)}</span>
                    <span>y: {som.y.toFixed(3)}</span>
                  </div>
                </div>
              )) || (
                <div className="text-xs text-slate-500">Brak danych topologicznych</div>
              )}
            </div>
          </div>

          {/* Fisher Information Rigidity (EWC) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-3">
            <h3 className="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <BarChart2 className="w-4 h-4 text-amber-400" />
              Sztywność Wag EWC (Fisher Matrix)
            </h3>
            <p className="text-xs text-slate-400">
              Rozkład empirycznej informacji Fishera $\log(1 + F_i)$ chroniący składnię przed katastroficznym zapominaniem:
            </p>

            {data?.fisher_diagnostics?.histogram ? (
              <div className="flex items-end gap-1 h-24 pt-3 px-1">
                {data.fisher_diagnostics.histogram.map((val, idx) => {
                  const maxVal = Math.max(...data.fisher_diagnostics.histogram, 1);
                  const heightPercent = Math.max(8, (val / maxVal) * 100);
                  return (
                    <div
                      key={idx}
                      className="flex-1 bg-amber-500/80 hover:bg-amber-400 transition-all rounded-t"
                      style={{ height: `${heightPercent}%` }}
                      title={`Kubełek ${idx + 1}: ${val} parametrów`}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500">Brak danych diagnostycznych</div>
            )}

            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800">
              <span>Wysoka plastyczność (Fakty)</span>
              <span className="text-amber-300">Sztywność bazowa (Gramatyka)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge Distillation Convergence Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-3">
        <h3 className="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
          Zbieżność Destylacji Wiedzy z Optymalizatorem SAM (Soft-Targets KL-Div)
        </h3>
        <p className="text-xs text-slate-400">
          Uczeń (Sieć KAN) transferuje rozkład prawdopodobieństw z modelu nauczyciela w płaskich minimach błędu:
        </p>

        {data?.distillation_metrics?.loss_history ? (
          <div className="flex items-center gap-2 overflow-x-auto py-2">
            {data.distillation_metrics.loss_history.map((loss, idx) => (
              <div
                key={idx}
                className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs flex flex-col items-center min-w-[70px]"
              >
                <span className="text-[10px] text-slate-500">Krok {idx + 1}</span>
                <span className="text-cyan-400 font-semibold">{loss.toFixed(3)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500">Brak historii zbieżności</div>
        )}
      </div>
    </div>
  );
};
