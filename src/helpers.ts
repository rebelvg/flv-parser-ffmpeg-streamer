export function sleep(mcs: number) {
  return new Promise(resolve => {
    setTimeout(resolve, mcs / 1000);
  });
}
