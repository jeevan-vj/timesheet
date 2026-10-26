import type { InvitationView } from "@/lib/invitation-view";

export class InvitationExistsError extends Error {
  readonly view: InvitationView;

  constructor(view: InvitationView) {
    super("invitation_exists");
    this.name = "InvitationExistsError";
    this.view = view;
  }
}
