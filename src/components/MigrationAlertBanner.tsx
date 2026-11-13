import { ShieldAlert, Terminal, RefreshCw } from "lucide-react";

export interface MigrationAlertBannerProps {
  migrationId: string;
  migrationFile: string;
  featureName: string;
  description: string;
  onRefresh?: () => void;
}

/**
 * Prominent luxury warning card displayed in admin sections when a required
 * Supabase database migration (tables or RPCs) has not yet been applied.
 * Distinguishes an unmigrated database from a truly empty record collection.
 */
export function MigrationAlertBanner({
  migrationId,
  migrationFile,
  featureName,
  description,
  onRefresh,
}: MigrationAlertBannerProps) {
  return (
    <div className="glass-panel p-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 mb-8 text-ivory shadow-lg">
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 mt-0.5">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <h3 className="font-display text-base text-amber-200">
              Database Migration Required: {featureName}
            </h3>
            <span className="text-[0.65rem] font-mono uppercase px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
              Migration {migrationId}
            </span>
          </div>
          <p className="text-xs text-ivory-dim leading-relaxed mb-3">
            {description}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 font-mono text-[0.72rem] text-champagne select-all">
              <Terminal className="w-3.5 h-3.5 text-mist shrink-0" />
              <span>{migrationFile}</span>
            </div>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium border border-amber-500/40 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Check Again</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
