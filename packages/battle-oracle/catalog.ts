// Referee combat catalog: official classic values for Veydrift unit types. Its unit stats are
// tested against the contract-parity preview catalog (catalog.test.ts); the rapidfire table follows
// the classic game where Veydrift's staged model 2 differs (Ion Cannon -> Reaper x2, no Reaper -> Ion Cannon).
import refereeCatalog from "./referee-catalog.json";
import type { CatalogEntry, Input } from "./oracle";

export const catalog: CatalogEntry[] = refereeCatalog.units.map((u) => ({
  type: u.type, order: u.order, attack: BigInt(u.attack), shield: BigInt(u.shield), hull: BigInt(u.hull)
}));
export const rapidfire: Input["rapidfire"] = refereeCatalog.rapidfire.map((r) => ({ shooter: r.shooter, target: r.target, factor: r.value }));
