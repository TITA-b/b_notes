import {
  BookOpen,
  Briefcase,
  Code2,
  FolderKanban,
  GraduationCap,
  Heart,
  Palette,
  Rocket,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const AREA_ICON_OPTIONS = [
  { name: "GraduationCap", Icon: GraduationCap },
  { name: "Briefcase", Icon: Briefcase },
  { name: "FolderKanban", Icon: FolderKanban },
  { name: "Palette", Icon: Palette },
  { name: "Code2", Icon: Code2 },
  { name: "Wrench", Icon: Wrench },
  { name: "Wallet", Icon: Wallet },
  { name: "BookOpen", Icon: BookOpen },
  { name: "Rocket", Icon: Rocket },
  { name: "Heart", Icon: Heart },
] as const;

export function getAreaIcon(name: string): LucideIcon {
  return (
    AREA_ICON_OPTIONS.find((option) => option.name === name)?.Icon ??
    FolderKanban
  );
}
