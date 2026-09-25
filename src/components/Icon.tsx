/**
 * Line icons from one small sprite file (public/img/icons.svg), downloaded once and cached.
 * Names match the sprite's symbols, e.g. <Icon name="calendar" />.
 */
export type IconName =
  | "home" | "grid" | "users" | "user" | "user-check" | "user-plus" | "file-text" | "file" | "edit" | "trending-up" | "check-square"
  | "check-circle" | "check" | "clock" | "calendar" | "book-open" | "book" | "message-square" | "message-circle" | "bell" | "credit-card"
  | "award" | "globe" | "gift" | "star" | "target" | "megaphone" | "sun" | "moon" | "umbrella" | "dollar" | "wallet" | "tag" | "list"
  | "alert" | "bar-chart" | "activity" | "shield" | "inbox" | "phone" | "compass" | "layers" | "settings" | "monitor" | "image" | "folder"
  | "link" | "zap" | "search" | "log-out" | "key" | "lock" | "menu" | "x" | "chevron-left" | "chevron-right" | "chevron-down" | "arrow-up"
  | "arrow-right" | "plus" | "download" | "upload" | "printer" | "paperclip" | "external" | "map-pin" | "mail" | "briefcase" | "plane"
  | "graduation" | "sprout" | "school" | "trash" | "eye" | "video" | "refresh" | "clipboard" | "info" | "pin" | "flag" | "wifi-off";

export function Icon({ name, className = "", label }: { name: IconName | string; className?: string; label?: string }) {
  return (
    <svg className={`icon ${className}`} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      <use href={`/img/icons.svg#i-${name}`} />
    </svg>
  );
}
