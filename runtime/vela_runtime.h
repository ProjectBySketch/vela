#ifndef VELA_RUNTIME_H
#define VELA_RUNTIME_H

#include <stddef.h>

typedef struct vela_value vela_value;
typedef struct vela_list vela_list;
typedef struct vela_map vela_map;

typedef enum {
  VELA_NIL = 0,
  VELA_NUM,
  VELA_BOOL,
  VELA_STR,
  VELA_LIST,
  VELA_MAP
} vela_type;

struct vela_list {
  size_t len;
  size_t cap;
  vela_value *items;
};

/* Insertion-ordered, linear lookup. Small and predictable on purpose. */
struct vela_map {
  size_t len;
  size_t cap;
  vela_value *keys;
  vela_value *vals;
};

struct vela_value {
  vela_type type;
  union {
    double num;
    int boolean;
    const char *str;
    vela_list *list;
    vela_map *map;
  } as;
};

#if defined(__GNUC__) || defined(__clang__)
#define VELA_NORETURN __attribute__((noreturn))
#else
#define VELA_NORETURN
#endif

/*
 * Output hook: the desktop runtime writes to stdout, while an embedding
 * shell (the iOS app) installs its own writer before running the program.
 */
typedef void (*vela_write_fn)(const char *text);
extern vela_write_fn vela_write_hook;
void vela_write(const char *text);

/* constructors */
vela_value vela_nil(void);
vela_value vela_num(double n);
vela_value vela_bool(int b);
vela_value vela_str(const char *s);
vela_value vela_list_from(size_t count, vela_value *items);

/* lists and maps */
vela_list *vela_as_list(vela_value v, const char *what);
vela_map *vela_as_map(vela_value v, const char *what);
vela_value vela_map_new(void);
vela_value vela_map_set(vela_value map, vela_value key, vela_value value);
vela_value vela_map_get(vela_value map, vela_value key);
int vela_map_has(vela_value map, vela_value key);
vela_value vela_map_remove(vela_value map, vela_value key);
vela_value vela_map_keys(vela_value map);
vela_value vela_map_values(vela_value map);

/* indexing: list[i], str[i], map[key] */
vela_value vela_index(vela_value container, vela_value index);
vela_value vela_set_index(vela_value container, vela_value index, vela_value value);

/* iteration: a list as-is, a map's keys, a string's characters */
vela_value vela_iter_list(vela_value v);

/* operators */
int vela_truthy(vela_value v);
vela_value vela_add(vela_value a, vela_value b);
vela_value vela_sub(vela_value a, vela_value b);
vela_value vela_mul(vela_value a, vela_value b);
vela_value vela_div(vela_value a, vela_value b);
vela_value vela_mod(vela_value a, vela_value b);
vela_value vela_neg(vela_value a);
vela_value vela_not(vela_value a);
vela_value vela_eq(vela_value a, vela_value b);
vela_value vela_ne(vela_value a, vela_value b);
vela_value vela_lt(vela_value a, vela_value b);
vela_value vela_le(vela_value a, vela_value b);
vela_value vela_gt(vela_value a, vela_value b);
vela_value vela_ge(vela_value a, vela_value b);

/* conversion and output */
const char *vela_to_cstr(vela_value v);
vela_value vela_print(vela_value v);
vela_value vela_println(vela_value v);
VELA_NORETURN void vela_panic(const char *fmt, ...);

/* builtins */
vela_value vela_builtin_len(vela_value v);
vela_value vela_builtin_push(vela_value list, vela_value item);
vela_value vela_builtin_at(vela_value list, vela_value index);
vela_value vela_builtin_set(vela_value list, vela_value index, vela_value value);
vela_value vela_builtin_str(vela_value v);
vela_value vela_builtin_num(vela_value v);
vela_value vela_builtin_type(vela_value v);
vela_value vela_builtin_abs(vela_value v);
vela_value vela_builtin_sqrt(vela_value v);
vela_value vela_builtin_floor(vela_value v);
vela_value vela_builtin_ceil(vela_value v);
vela_value vela_builtin_assert(vela_value v);
vela_value vela_builtin_error(vela_value v);
vela_value vela_builtin_range(vela_value v);

/* strings */
vela_value vela_builtin_split(vela_value s, vela_value sep);
vela_value vela_builtin_join(vela_value list, vela_value sep);
vela_value vela_builtin_upper(vela_value s);
vela_value vela_builtin_lower(vela_value s);
vela_value vela_builtin_trim(vela_value s);
vela_value vela_builtin_contains(vela_value haystack, vela_value needle);
vela_value vela_builtin_replace(vela_value s, vela_value from, vela_value to);
vela_value vela_builtin_starts_with(vela_value s, vela_value prefix);
vela_value vela_builtin_ends_with(vela_value s, vela_value suffix);
vela_value vela_builtin_index_of(vela_value haystack, vela_value needle);

/* maps */
vela_value vela_builtin_keys(vela_value map);
vela_value vela_builtin_values(vela_value map);
vela_value vela_builtin_has(vela_value map, vela_value key);
vela_value vela_builtin_remove(vela_value map, vela_value key);

#endif /* VELA_RUNTIME_H */
