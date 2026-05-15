import {
  BookOpen,
  Brain,
  Film,
  FolderOpen,
  House,
  Image as ImageIcon,
  LayoutTemplate,
  Mic,
  MonitorPlay,
  PlaySquare,
  Settings,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { SUPER_ADMIN_DEMO_ACTOR_ID } from "../../../lib/local-loopback";

export type NavItem = {
  name: string;
  path?: string;
  icon: LucideIcon;
  children?: Array<{
    name: string;
    path: string;
    icon: LucideIcon;
  }>;
};

export type DemoActor = {
  id: string;
  label: string;
  detail: string;
};

export const navItems: NavItem[] = [
  { name: "首页", path: "/home", icon: House },
  { name: "创意入口", path: "/playground", icon: Brain },
  {
    name: "通用创作",
    icon: ImageIcon,
    children: [
      { name: "图片创作", path: "/create/image", icon: ImageIcon },
      { name: "视频创作", path: "/create/video", icon: Video },
    ],
  },
  {
    name: "剧集创作",
    icon: Film,
    children: [
      { name: "全局设定", path: "/comic/global", icon: Settings },
      { name: "故事叙述", path: "/comic/script", icon: BookOpen },
      { name: "角色场景资产", path: "/comic/entities", icon: Users },
      { name: "分镜脚本", path: "/comic/storyboard", icon: LayoutTemplate },
      { name: "分镜视频", path: "/comic/video", icon: PlaySquare },
      { name: "配音与口型", path: "/comic/dubbing", icon: Mic },
      { name: "成片预览", path: "/comic/preview", icon: MonitorPlay },
    ],
  },
  { name: "项目管理", path: "/assets", icon: FolderOpen },
];

export const demoActors: DemoActor[] = [
  { id: "guest", label: "游客", detail: "浏览案例与注册入口，不可创建作品" },
  { id: "user_personal_001", label: "注册用户", detail: "个人项目、个人资产与积分钱包" },
  { id: "user_member_001", label: "企业成员", detail: "共享项目、企业资产与团队协作" },
  { id: "user_demo_001", label: "企业管理员", detail: "成员管理、钱包扣费与共享权限" },
  { id: "ops_demo_001", label: "运营管理员", detail: "平台配置、企业审核与订单管理" },
  { id: SUPER_ADMIN_DEMO_ACTOR_ID, label: "超级管理员", detail: "系统配置、审计日志与风控能力" },
];
