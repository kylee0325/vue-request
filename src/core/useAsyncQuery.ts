import type { Ref } from 'vue-demi';
import { computed, inject, onUnmounted, reactive, ref, watch } from 'vue-demi';

import { getGlobalOptions, GLOBAL_OPTIONS_PROVIDE_KEY } from './config';
import createQuery from './createQuery';
import type {
  BaseOptions,
  BaseResult,
  Config,
  GlobalOptions,
  Mutate,
  Queries,
  Query,
  State,
  UnWrapState,
} from './types';
import { omit, resolvedPromise, unRefObject } from './utils';
import { getCache, setCache } from './utils/cache';

const QUERY_DEFAULT_KEY = '__QUERY_DEFAULT_KEY__';

function useAsyncQuery<R, P extends unknown[]>(
  query: Query<R, P>,
  options: BaseOptions<R, P>,
): BaseResult<R, P> {
  const injectedGlobalOptions = inject<GlobalOptions>(
    GLOBAL_OPTIONS_PROVIDE_KEY,
    {},
  );

  const {
    cacheKey,
    defaultParams = ([] as unknown) as P,
    manual = false,
    ready = ref(true),
    refreshDeps = [],
    loadingDelay = 0,
    pollingWhenHidden = false,
    pollingWhenOffline = false,
    refreshOnWindowFocus = false,
    refocusTimespan = 5000,
    cacheTime = 600000,
    staleTime = 0,
    errorRetryCount = 0,
    errorRetryInterval = 0,
    queryKey,
    ...rest
  } = {
    ...getGlobalOptions(),
    ...injectedGlobalOptions,
    ...options,
  };

  const stopPollingWhenHiddenOrOffline = ref(false);
  // skip debounce when initail run
  const initialAutoRunFlag = ref(false);

  const updateCache = (state: State<R, P>) => {
    if (!cacheKey) return;

    const cacheData = getCache<R, P>(cacheKey)?.data;
    const cacheQueries = cacheData?.queries;
    const queryData = unRefObject(state);
    const currentQueryKey =
      queryKey?.(...state.params.value) ?? QUERY_DEFAULT_KEY;

    setCache<R, P>(
      cacheKey,
      {
        queries: {
          ...cacheQueries,
          [currentQueryKey]: {
            ...cacheQueries?.[currentQueryKey],
            ...queryData,
          },
        },
        latestQueriesKey: currentQueryKey,
      },
      cacheTime,
    );
  };

  const config = {
    initialAutoRunFlag,
    loadingDelay,
    pollingWhenHidden,
    pollingWhenOffline,
    stopPollingWhenHiddenOrOffline,
    cacheKey,
    errorRetryCount,
    errorRetryInterval,
    refreshOnWindowFocus,
    refocusTimespan,
    updateCache,
    ...omit(rest, ['pagination', 'listKey']),
  } as Config<R, P>;

  const loading = ref(false);
  const data = ref<R>();
  const error = ref<Error>();
  const params = ref() as Ref<P>;

  const queries = <Queries<R, P>>reactive({
    [QUERY_DEFAULT_KEY]: reactive(createQuery(query, config)),
  });

  const latestQueriesKey = ref(QUERY_DEFAULT_KEY);

  const latestQuery = computed(() => queries[latestQueriesKey.value] ?? {});

  // sync state
  watch(
    latestQuery,
    queryData => {
      loading.value = queryData.loading;
      data.value = queryData.data;
      error.value = queryData.error;
      params.value = queryData.params;
    },
    {
      immediate: true,
      deep: true,
    },
  );

  // init queries from cache
  if (cacheKey) {
    const cache = getCache<R, P>(cacheKey);

    if (cache?.data?.queries) {
      Object.keys(cache.data.queries).forEach(key => {
        const cacheQuery = cache.data.queries![key];

        queries[key] = <UnWrapState<R, P>>reactive(
          createQuery(query, config, {
            loading: cacheQuery.loading,
            params: cacheQuery.params,
            data: cacheQuery.data,
            error: cacheQuery.error,
          }),
        );
      });
      /* istanbul ignore else */
      if (cache.data.latestQueriesKey) {
        latestQueriesKey.value = cache.data.latestQueriesKey;
      }
    }
  }

  const tempReadyParams = ref();
  const hasTriggerReady = ref(false);
  const run = (...args: P) => {
    if (!ready.value && !hasTriggerReady.value) {
      tempReadyParams.value = args;
      return resolvedPromise;
    }

    const newKey = queryKey?.(...args) ?? QUERY_DEFAULT_KEY;

    if (!queries[newKey]) {
      queries[newKey] = <UnWrapState<R, P>>reactive(createQuery(query, config));
    }

    latestQueriesKey.value = newKey;

    return latestQuery.value.run(...args);
  };

  const reset = () => {
    unmountQueries();
    latestQueriesKey.value = QUERY_DEFAULT_KEY;
    queries[QUERY_DEFAULT_KEY] = <UnWrapState<R, P>>(
      reactive(createQuery(query, config))
    );
  };

  // unmount queries
  const unmountQueries = () => {
    Object.keys(queries).forEach(key => {
      queries[key].cancel();
      queries[key].unmount();
      delete queries[key];
    });
  };

  const cancel = () => latestQuery.value.cancel();
  const refresh = () => latestQuery.value.refresh();
  const mutate = <Mutate<R>>((arg: R) => latestQuery.value.mutate(arg));

  // initial run
  if (!manual) {
    initialAutoRunFlag.value = true;

    // TODO: need refactor
    const cache = getCache<R, P>(cacheKey!);
    const cacheQueries = cache?.data.queries ?? {};

    const isFresh =
      cache &&
      (staleTime === -1 || cache.cacheTime + staleTime > new Date().getTime());

    const hasCacheQueries = Object.keys(cacheQueries).length > 0;

    if (!isFresh) {
      if (hasCacheQueries) {
        Object.keys(queries).forEach(key => {
          queries[key]?.refresh();
        });
      } else {
        run(...defaultParams);
      }
    }

    initialAutoRunFlag.value = false;
  }

  // watch ready
  const stopReady = ref();
  stopReady.value = watch(
    ready,
    val => {
      hasTriggerReady.value = true;
      if (val && tempReadyParams.value) {
        run(...tempReadyParams.value);
        // destroy current watch
        stopReady.value();
      }
    },
    {
      flush: 'sync',
    },
  );

  // watch refreshDeps
  if (refreshDeps.length) {
    watch(refreshDeps, () => {
      !manual && latestQuery.value.refresh();
    });
  }

  onUnmounted(() => {
    unmountQueries();
  });

  return {
    loading,
    data,
    error,
    params,
    cancel,
    refresh,
    mutate,
    run,
    reset,
    queries,
  };
}

export default useAsyncQuery;
