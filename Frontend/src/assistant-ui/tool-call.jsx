import React from "react";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, } from "./collapsible.js";
import { cn } from "./element-utils.js";
import { collapsePanel, mono, ShimmerLabel, SwapLabel, } from "./element-utils.js";
export function ToolCall({ label, activeLabel, query, request, result, running, open, onOpenChange, className, children, }) {
    return (<Collapsible data-slot="tool-call" open={open} onOpenChange={onOpenChange} className={cn("w-full max-w-sm", className)}>
      <CollapsibleTrigger className="group/trigger text-foreground/55 hover:text-foreground/90 flex items-center gap-2 rounded-md py-1 text-[13.5px] transition-colors outline-none">
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"/>
        <SwapLabel active={running ? 0 : 1} className="text-start">
          <ShimmerLabel active={running} className="relative inline-block leading-none">
            {activeLabel}
          </ShimmerLabel>
          <>{label}</>
        </SwapLabel>
        <span className={cn(mono, "bg-foreground/[0.06] text-foreground/70 rounded-md px-1.5 py-0.5")}>
          {query}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        {children}
      </CollapsibleContent>
    </Collapsible>);
}
