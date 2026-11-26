import React from "react";
export { CATEGORY_COLORS } from "@/lib/categoryColors";
import {
  Utensils,
  ShoppingCart,
  Coffee,
  Car,
  Fuel,
  Bus,
  ShoppingBag,
  Shirt,
  Smartphone,
  Zap,
  Droplets,
  Wifi,
  Home,
  HeartPulse,
  Pill,
  Gamepad2,
  Tv,
  Film,
  GraduationCap,
  Gift,
  Plane,
  Dog,
  Sparkles,
  Scissors,
  Banknote,
  Briefcase,
  Laptop,
  TrendingUp,
  Building,
  Shield,
  Baby,
  Dumbbell,
  Receipt,
  CreditCard,
  Wrench,
  PiggyBank,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

export interface CategoryIconOption {
  id: string;
  name: string;
  Icon: LucideIcon;
}

export const CATEGORY_ICON_LIST: CategoryIconOption[] = [
  { id: "utensils", name: "Dining", Icon: Utensils },
  { id: "shopping-cart", name: "Groceries", Icon: ShoppingCart },
  { id: "coffee", name: "Coffee", Icon: Coffee },
  { id: "car", name: "Car", Icon: Car },
  { id: "fuel", name: "Fuel", Icon: Fuel },
  { id: "bus", name: "Transit", Icon: Bus },
  { id: "shopping-bag", name: "Shopping", Icon: ShoppingBag },
  { id: "shirt", name: "Clothing", Icon: Shirt },
  { id: "smartphone", name: "Phone/Load", Icon: Smartphone },
  { id: "zap", name: "Electricity", Icon: Zap },
  { id: "droplets", name: "Water", Icon: Droplets },
  { id: "wifi", name: "Internet", Icon: Wifi },
  { id: "home", name: "Housing", Icon: Home },
  { id: "heart-pulse", name: "Health", Icon: HeartPulse },
  { id: "pill", name: "Medicine", Icon: Pill },
  { id: "gamepad-2", name: "Gaming", Icon: Gamepad2 },
  { id: "tv", name: "Streaming", Icon: Tv },
  { id: "film", name: "Movies", Icon: Film },
  { id: "graduation-cap", name: "Education", Icon: GraduationCap },
  { id: "gift", name: "Gift", Icon: Gift },
  { id: "plane", name: "Travel", Icon: Plane },
  { id: "dog", name: "Pets", Icon: Dog },
  { id: "sparkles", name: "Beauty", Icon: Sparkles },
  { id: "scissors", name: "Salon", Icon: Scissors },
  { id: "banknote", name: "Salary", Icon: Banknote },
  { id: "briefcase", name: "Business", Icon: Briefcase },
  { id: "laptop", name: "Freelance", Icon: Laptop },
  { id: "trending-up", name: "Investments", Icon: TrendingUp },
  { id: "building", name: "Rent", Icon: Building },
  { id: "shield", name: "Insurance", Icon: Shield },
  { id: "baby", name: "Kids", Icon: Baby },
  { id: "dumbbell", name: "Fitness", Icon: Dumbbell },
  { id: "receipt", name: "Bills", Icon: Receipt },
  { id: "credit-card", name: "Card/Fees", Icon: CreditCard },
  { id: "wrench", name: "Repairs", Icon: Wrench },
  { id: "piggy-bank", name: "Savings", Icon: PiggyBank },
  { id: "more-horizontal", name: "Others", Icon: MoreHorizontal },
];

const iconMap = new Map<string, LucideIcon>(
  CATEGORY_ICON_LIST.map((item) => [item.id, item.Icon])
);

export function getCategoryIconComponent(iconId?: string | null): LucideIcon {
  if (!iconId) return MoreHorizontal;
  return iconMap.get(iconId) || MoreHorizontal;
}

export function CategoryIcon({
  icon,
  color,
  size = 18,
  className,
  style,
}: {
  icon?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const IconComp = getCategoryIconComponent(icon);
  return (
    <span
      className={`category-icon-wrapper ${className || ""}`}
      style={{
        backgroundColor: color ? `${color}29` : "var(--muted)",
        color: color || "var(--foreground)",
        display: "inline-grid",
        placeItems: "center",
        borderRadius: "10px",
        width: `${size + 14}px`,
        height: `${size + 14}px`,
        flexShrink: 0,
        ...style,
      }}
    >
      <IconComp size={size} strokeWidth={2} />
    </span>
  );
}
