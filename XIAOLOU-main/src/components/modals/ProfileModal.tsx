import { Camera, LoaderCircle, User as UserIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { uploadFile, type PermissionContext, updateMe } from "../../lib/api";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: PermissionContext | null;
  onUpdateContext: (context: PermissionContext) => void;
}

export function ProfileModal({ isOpen, onClose, context, onUpdateContext }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && context) {
      setDisplayName(context.actor.displayName || "");
      setAvatar(context.actor.avatar || null);
    }
  }, [isOpen, context]);

  if (!isOpen || !context) return null;

  const handleSave = async () => {
    if (!displayName.trim()) return;
    setIsSaving(true);
    try {
      const updatedContext = await updateMe({
        displayName: displayName.trim(),
        avatar,
      });
      onUpdateContext(updatedContext);
      onClose();
    } catch (error) {
      console.error("Failed to update profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    // Show a local preview immediately while upload is in progress
    const localPreview = URL.createObjectURL(file);
    setAvatar(localPreview);

    try {
      const uploaded = await uploadFile(file, "avatar");
      setAvatar(uploaded.urlPath || uploaded.url);
    } catch (error) {
      console.error("Avatar upload failed:", error);
      setAvatar(null);
      alert("头像上传失败，请重试");
    } finally {
      URL.revokeObjectURL(localPreview);
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="mb-6 text-xl font-semibold text-foreground">个人中心</h2>

        <div className="flex flex-col items-center gap-6">
          <div className="relative group">
            <div className="relative flex h-24 w-24 overflow-hidden rounded-full border-4 border-background bg-muted shadow-sm">
              {avatar ? (
                <img src={avatar} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                  <UserIcon className="h-10 w-10" />
                </div>
              )}
              
              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/png, image/jpeg, image/webp"
              className="hidden"
            />
          </div>

          <div className="w-full space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="displayName" className="text-sm font-medium text-foreground">
                昵称
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
                placeholder="输入你的昵称"
                maxLength={30}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">账号邮箱</label>
              <div className="w-full rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {context.actor.email || "未绑定邮箱"}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">角色身份</label>
              <div className="w-full rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {context.platformRole === "super_admin" ? "超级管理员" : 
                 context.platformRole === "ops_admin" ? "运营管理员" :
                 context.currentOrganizationRole === "enterprise_admin" ? "企业管理员" :
                 context.currentOrganizationRole === "enterprise_member" ? "企业成员" : "普通用户"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !displayName.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            保存修改
          </button>
        </div>
      </div>
    </div>
  );
}
