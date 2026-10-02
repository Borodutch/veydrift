/** No environment override: this uncapped writer must not be activated by deployment config. */
export function assertStandaloneKeeperReleaseAllowed(): void {
  throw new Error("Standalone battle-keeper disabled: signed and retained envelopes lack the resolver USD fee cap; use the reviewed backend resolver only");
}
