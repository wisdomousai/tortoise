// A child for the process plugin's tests: prints the text it reads from descriptors 3 and 4.
import { readFileSync } from 'node:fs';

console.log(JSON.stringify([3, 4].map((fd) => readFileSync(fd, 'utf8'))));
