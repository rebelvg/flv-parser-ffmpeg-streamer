import * as fs from 'fs';
import * as os from 'os';
import * as _ from 'lodash';

const LOGS_PATH = 'logger.log';

fs.writeFileSync(LOGS_PATH, ['log created.'].join(' ') + os.EOL);

export function logger(logs: any[], print: boolean = false) {
  const logsString: string = logs
    .map(log => {
      if (typeof log === 'object') {
        return JSON.stringify(log, null, 2);
      } else {
        return log;
      }
    })
    .join(os.EOL);

  if (print) {
    console.log(logsString);
  }

  fs.appendFile(LOGS_PATH, `${logsString}${os.EOL}`, () => {});
}
