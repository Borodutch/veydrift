import { GAME_UNAVAILABLE_MESSAGE, GAME_UNAVAILABLE_TITLE, isGameUnavailableMessage } from "../gameUnavailable";

export { GAME_UNAVAILABLE_MESSAGE, GAME_UNAVAILABLE_TITLE, isGameUnavailableMessage };

export function GameUnavailableNotice({ className = "" }: { className?: string | undefined }) {
  return (
    <div
      className={`rounded border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100 ${className}`.trim()}
      role="alert"
    >
      <p className="font-semibold text-amber-50">{GAME_UNAVAILABLE_TITLE}</p>
      <p className="mt-1 text-amber-100/85">{GAME_UNAVAILABLE_MESSAGE}</p>
    </div>
  );
}
