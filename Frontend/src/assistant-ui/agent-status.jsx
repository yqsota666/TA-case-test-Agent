import React from "react";
import { CheckIcon, PauseIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { cn } from "./element-utils.js";
import { mono, paper } from "./element-utils.js";
export function AgentStatus({ state, label, elapsed, trailing, className, ...props }) {
    return (<span data-slot="agent-status" className={cn(paper, "flex items-center gap-2.5 rounded-full py-1.5 ps-3.5 pe-1.5", className)} {...props}>
      {state === "done" ? (<CheckIcon aria-hidden className="size-3 shrink-0 text-emerald-500"/>) : state === "failed" ? (<XIcon aria-hidden className="text-destructive size-3 shrink-0"/>) : (<span aria-hidden className={cn("size-1.5 shrink-0 rounded-full motion-reduce:animate-none", state === "working"
                ? "animate-pulse bg-blue-500 dark:bg-blue-400"
                : "border-foreground/35 border")}/>)}
      <span className="sr-only">{{ working: "进行中", waiting: "等待处理", done: "已完成", failed: "失败" }[state]}</span>
      <span key={label} className="fade-in blur-in-[2px] animate-in max-w-44 truncate text-xs duration-300 motion-reduce:animate-none">
        {label}
      </span>
      {elapsed !== undefined && state !== "done" && state !== "failed" && (<span className={cn(mono, "text-foreground/30 tabular-nums")}>
          {elapsed}
        </span>)}
      <span aria-hidden data-slot="agent-status-trailing" className="text-foreground/45 flex size-6 items-center justify-center rounded-full">
        {trailing !== undefined ? (trailing) : state === "done" || state === "failed" ? (<RotateCcwIcon className="size-3"/>) : (<PauseIcon className="size-3"/>)}
      </span>
    </span>);
}
