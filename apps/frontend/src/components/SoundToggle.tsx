import { Volume2, VolumeX } from "lucide-preact";
import { isSfxMuted, playSfx, setSfxMuted, startSfxLoop } from "../sfx";

// Hook-free sound toggle: the muted flag lives in the sfx module and is
// mirrored to <html data-sfx-muted>, so both icons render and CSS picks the
// visible one. Works inside components that tests invoke as plain functions.
export function SoundToggle({ className = "" }: { className?: string | undefined }) {
  return (
    <button
      aria-label="Toggle sound effects"
      className={className}
      onClick={() => {
        const nextMuted = !isSfxMuted();
        setSfxMuted(nextMuted);
        if (!nextMuted) {
          playSfx("click");
          startSfxLoop("ambient");
        }
      }}
      title="Toggle sound effects"
      type="button"
    >
      <Volume2 aria-hidden="true" className="sound-toggle-icon-on" size={14} strokeWidth={2} />
      <VolumeX aria-hidden="true" className="sound-toggle-icon-off" size={14} strokeWidth={2} />
    </button>
  );
}
