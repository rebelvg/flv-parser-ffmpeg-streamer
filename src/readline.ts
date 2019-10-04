import * as ReadLine from 'readline';

import { switchVideoRequest } from './parse-stream';

export function attachReadline() {
  const readLine = ReadLine.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  readLine.on('line', line => {
    if (line === 's') {
      switchVideoRequest();
    }
  });
}
