import { GAME_UNAVAILABLE_MESSAGE, GAME_UNAVAILABLE_TITLE, isGameUnavailableMessage } from "../gameUnavailable";
import { InlineStateNotice } from "./InlineStateNotice";

export { GAME_UNAVAILABLE_MESSAGE, GAME_UNAVAILABLE_TITLE, isGameUnavailableMessage };

export function GameUnavailableNotice({ className = "" }: { className?: string | undefined }) {
  return (
    <InlineStateNotice
      blocking
      className={className}
      title={GAME_UNAVAILABLE_TITLE}
      tone="error"
    >
      {GAME_UNAVAILABLE_MESSAGE}
    </InlineStateNotice>
  );
}
