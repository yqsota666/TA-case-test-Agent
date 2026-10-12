import React from "react";
import { NameButton } from './name-button.jsx';
import { PencilIcon, Trash2Icon } from "lucide-react";
import { cn } from "./element-utils.js";
import { field, mono } from "./element-utils.js";
export function ThreadList({ threads, activeIndex, onActiveIndexChange, onRename, onDelete, className, ...props }) {
    return (<div data-slot="thread-list" className={cn("flex w-full max-w-[240px] flex-col gap-0.5", className)} {...props}>
      {threads.map((thread, i) => {
            const active = i === activeIndex;
            const hasActions = onRename !== undefined || onDelete !== undefined;
            const hasTwoActions = onRename !== undefined && onDelete !== undefined;
            const rowClassName = cn("group relative flex w-full items-center rounded-xl text-[13.5px] transition-colors", active
                ? field
                : onActiveIndexChange
                    ? "hover:bg-foreground/[0.03]"
                    : undefined);
            const contentClassName = cn("flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 text-start", hasActions &&
                (onActiveIndexChange
                    ? hasTwoActions
                        ? "group-focus-within:pe-14 group-hover:pe-14"
                        : "group-focus-within:pe-9 group-hover:pe-9"
                    : hasTwoActions
                        ? "pe-14"
                        : "pe-9"));
            const content = (<>
            <span className="flex-1 truncate">{thread.title}</span>
            <span className={cn(mono, "text-foreground/35 flex items-center gap-1.5 tabular-nums", hasActions &&
                    onActiveIndexChange &&
                    "group-focus-within:hidden group-hover:hidden")}>
              {thread.unread && !active && (<>
                  <span aria-hidden className="size-1.5 rounded-full bg-blue-500 dark:bg-blue-400"/>
                  <span className="sr-only">未读</span>
                </>)}
              {thread.time}
            </span>
          </>);
            return (<div key={thread.id} className={rowClassName}>
            {onActiveIndexChange ? (<NameButton type="button" aria-current={active ? "page" : undefined} onClick={() => onActiveIndexChange(i)} onRename={onRename?()=>onRename(i):undefined} title={onRename?'双击或按 F2 改名':undefined} className={contentClassName}>
                {content}
              </NameButton>) : (<div aria-current={active || undefined} className={contentClassName}>
                {content}
              </div>)}
            {hasActions && (<div className={cn("absolute end-2 flex items-center gap-0.5", onActiveIndexChange &&
                        "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}>
                {onRename && (<button type="button" aria-label={`重命名${thread.title}`} onClick={() => onRename(i)} className="text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/90 rounded-full p-1">
                    <PencilIcon className="size-3"/>
                  </button>)}
                {onDelete && (<button type="button" aria-label={`Delete ${thread.title}`} onClick={() => onDelete(i)} className="text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/90 rounded-full p-1">
                    <Trash2Icon className="size-3"/>
                  </button>)}
              </div>)}
          </div>);
        })}
    </div>);
}
