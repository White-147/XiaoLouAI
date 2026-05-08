import type { PermissionContext, UploadedFile } from "../../../../lib/api";

type AvatarUploadResult = Pick<UploadedFile, "signedReadUrl" | "urlPath" | "url">;

export function resolveAvatarUploadUrl(uploaded: AvatarUploadResult) {
  const avatarUrl = (uploaded.signedReadUrl || uploaded.urlPath || uploaded.url || "").trim();
  if (!avatarUrl) {
    throw new Error("Avatar upload did not return a usable URL");
  }
  return avatarUrl;
}

export function mergeProfileUpdateContext(
  context: PermissionContext,
  patch: {
    displayName?: string;
    avatar?: string | null;
    phone?: string | null;
    defaultOrganizationId?: string | null;
  },
): PermissionContext {
  return {
    ...context,
    actor: {
      ...context.actor,
      displayName: patch.displayName?.trim() || context.actor.displayName,
      avatar: patch.avatar === undefined ? context.actor.avatar : patch.avatar,
      phone: patch.phone === undefined ? context.actor.phone : patch.phone,
      defaultOrganizationId:
        patch.defaultOrganizationId === undefined
          ? context.actor.defaultOrganizationId
          : patch.defaultOrganizationId,
    },
  };
}
