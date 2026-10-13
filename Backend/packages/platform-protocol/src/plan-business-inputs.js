import {isDeepStrictEqual} from 'node:util';
export const planBusinessInputs=plan=>({objective:plan?.objective,preconditions:plan?.preconditions,scenarios:plan?.scenarios?.map(({setup,action})=>({setup,action})),exchangePlan:plan?.exchangePlan});
export function samePlanBusinessInputs(previous,next) {
  return Boolean(previous && next && isDeepStrictEqual(planBusinessInputs(previous),planBusinessInputs(next)));
}
