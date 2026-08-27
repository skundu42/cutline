import {makeProject} from '@motion-canvas/core';
import overview from './scenes/01-overview?scene';
import inspect from './scenes/02-inspect?scene';
import branch from './scenes/03-branch?scene';
import edit from './scenes/04-edit?scene';
import protect from './scenes/05-protect?scene';
import prove from './scenes/06-prove?scene';

export default makeProject({
  scenes: [overview, inspect, branch, edit, protect, prove],
});
