import React from "react";

export const ObjectTitle: React.FC<{
  size?: "small" | "default" | "large";
  icon?: React.ReactNode;
  title: string | React.ReactNode;
}> = ({ icon, title, size = "default" }) => {
  const iconClassName = (() => {
    switch (size) {
      case "small":
        return "h-4 w-4 flex-shrink-0";
      case "large":
        return "h-10 w-10 flex-shrink-0";
      default:
        return "h-6 w-6 flex-shrink-0";
    }
  })();
  return (
    <div className={`flex overflow-auto items-center ${size !== "small" ? "gap-3" : "gap-2"}`}>
      {icon && <div className={iconClassName}>{icon}</div>}
      <div className={`text-text truncate overflow-hidden  ${size !== "small" ? "font-semibold" : ""}`}>{title}</div>
    </div>
  );
};
