import { Wand2 } from "lucide-react";

export function NoProjectEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/8">
          <Wand2 className="h-7 w-7 text-primary/50" />
        </div>
        <p className="text-sm font-medium text-foreground">请先选择一个项目</p>
        <p className="mt-1 text-xs text-muted-foreground">
          返回首页选择或创建项目后，再使用剧本拆解工具。
        </p>
      </div>
    </div>
  );
}
