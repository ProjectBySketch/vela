/* Desktop entry point: run the Vela program's top-level code. */

#include "vela_runtime.h"

vela_value vela_main(void);

int main(void) {
  (void)vela_main();
  fflush(stdout);
  return 0;
}
