import React from "react";
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react";
import { cn } from "./element-utils.js";
import { mono, paper, ShimmerLabel } from "./element-utils.js";
export function ArtifactCard({ title, meta, generating = false, words = 0, className, ...props }) {
    return (<button type="button" data-slot="artifact-card" className={cn(paper, "group flex w-full max-w-xs cursor-pointer items-center gap-3 rounded-[20px] p-3.5 transition-transform duration-150 hover:-translate-y-px active:scale-[0.98]", className)} {...props}>
      <span className="bg-foreground/[0.05] text-foreground/45 flex size-9 shrink-0 items-center justify-center rounded-xl">
        <FileTextIcon className={cn("size-4", generating && "animate-pulse motion-reduce:animate-none")}/>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{title}</p>
        {generating ? (<p className={cn(mono, "text-foreground/40 flex items-center gap-1")}>
            <ShimmerLabel className="relative inline-block leading-none">
              整理中
            </ShimmerLabel>
            <span>·</span>
            <span className="tabular-nums"></span>
          </p>) : (<p className={cn(mono, "fade-in blur-in-[2px] animate-in text-foreground/40 duration-300 motion-reduce:animate-none")}>
            {meta}
          </p>)}
      </div>
      <ArrowUpRightIcon className="text-foreground/35 size-3.5 opacity-0 transition-opacity group-hover:opacity-100"/>
    </button>);
}
