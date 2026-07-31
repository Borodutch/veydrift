import {
  ArrowLeftRight,
  Bomb,
  Crosshair,
  Flag,
  Recycle,
  Rocket,
  Shield,
  type LucideIcon,
} from "lucide-preact";
import type { GalaxyActionKind } from "../galaxyActions";

export function galaxyActionIcon(kind: GalaxyActionKind): LucideIcon {
  if (kind === "attack") return Crosshair;
  if (kind === "transport") return ArrowLeftRight;
  if (kind === "deploy") return Rocket;
  if (kind === "colonize") return Flag;
  if (kind === "harvest") return Recycle;
  if (kind === "missileAttack") return Bomb;
  return Shield;
}
