import React from 'react';
export const cn=(...values)=>values.filter(Boolean).join(' ');
export const take=(items,count)=>items.slice(0,count);
export const paper='aui-surface',field='aui-field',floating='aui-floating',mono='aui-secondary',ghostButton='aui-icon-button',inkButton='cw-primary-button';
export function ShimmerLabel({children,active,...props}) {return React.createElement('span',props,children);}
export const collapsePanel='aui-collapse-panel',fieldInteractive='aui-field-button';
export function SwapLabel({active,children,...props}) {return React.createElement('span',props,React.Children.toArray(children)[active]);}
export function safeHref(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}
export function hostOf(value){const href=safeHref(value);return href?new URL(href).hostname:undefined;}
