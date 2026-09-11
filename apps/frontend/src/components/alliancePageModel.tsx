import type { ChainAllianceState } from "../walletFlow";

export type InviteEntry = ChainAllianceState["pendingInvites"][number];

export type JoinRequestEntry = ChainAllianceState["allianceJoinRequests"][number];

export function hasAllianceMembership(allianceState: ChainAllianceState | null): boolean {
  return Boolean(allianceState?.profile && allianceState.membership.allianceId !== "0");
}

export function allianceJoinRequestApprovalState(
  allianceState: ChainAllianceState | null,
  request: JoinRequestEntry
): { canApprove: boolean; reason: string | null } {
  if (!allianceState) {
    return { canApprove: false, reason: "Alliance state is still loading." };
  }

  const role = allianceState.membership.role;
  if (role !== "owner" && role !== "officer") {
    return { canApprove: false, reason: "Only officers and owners can approve applications." };
  }

  const currentAllianceId = allianceState.membership.allianceId;
  if (currentAllianceId === "0" || request.allianceId !== currentAllianceId) {
    return { canApprove: false, reason: "You are not managing this alliance." };
  }

  const requester = request.requester.toLowerCase();
  const rosterMember = allianceState.members.find((member) => member.address.toLowerCase() === requester);
  const requesterAllianceId = request.requesterMembership?.allianceId ?? "0";
  if (rosterMember || requesterAllianceId === currentAllianceId) {
    return { canApprove: false, reason: "Applicant is already in this alliance." };
  }

  if (requesterAllianceId !== "0") {
    return { canApprove: false, reason: "Applicant already joined another alliance." };
  }

  return { canApprove: true, reason: null };
}

export function allianceJoinRequestDismissalState(
  allianceState: ChainAllianceState | null,
  request: JoinRequestEntry
): { canDismiss: boolean; reason: string | null } {
  if (!allianceState) {
    return { canDismiss: false, reason: "Alliance state is still loading." };
  }

  const role = allianceState.membership.role;
  if (role !== "owner" && role !== "officer") {
    return { canDismiss: false, reason: "Only officers and owners can dismiss applications." };
  }

  const currentAllianceId = allianceState.membership.allianceId;
  if (currentAllianceId === "0" || request.allianceId !== currentAllianceId) {
    return { canDismiss: false, reason: "You are not managing this alliance." };
  }

  return { canDismiss: true, reason: null };
}

export function allianceInviteAcceptanceState(
  allianceState: ChainAllianceState | null,
  invite: InviteEntry
): { canAccept: boolean; reason: string | null } {
  if (!allianceState) {
    return { canAccept: false, reason: "Alliance state is still loading." };
  }

  if (allianceState.membership.allianceId !== "0") {
    return { canAccept: false, reason: "You are already in an alliance." };
  }

  const pendingInvite = allianceState.pendingInvites.find((entry) => entry.allianceId === invite.allianceId);
  if (!pendingInvite) {
    return { canAccept: false, reason: "This invitation is no longer pending." };
  }

  const alliance = allianceState.directory.find((entry) => entry.allianceId === invite.allianceId);
  if (!alliance?.active) {
    return { canAccept: false, reason: "This alliance is unavailable." };
  }

  return { canAccept: true, reason: null };
}
