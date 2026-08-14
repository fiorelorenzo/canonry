import { valdoriaReach } from './valdoria-reach.js';
import { brackwaterMire } from './brackwater-mire.js';
import { thornwickCollege } from './thornwick-college.js';
import type { PropagationWorld } from '../types.js';

export { valdoriaReach, brackwaterMire, thornwickCollege };

/** Every world in the propagation corpus, in a fixed order. */
export const propagationWorlds: PropagationWorld[] = [
	valdoriaReach,
	brackwaterMire,
	thornwickCollege
];
