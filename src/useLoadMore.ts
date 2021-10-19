import type { Ref } from 'vue-demi';
import { computed, inject, ref, watchEffect } from 'vue-demi';

import { getGlobalOptions, GLOBAL_OPTIONS_PROVIDE_KEY } from './core/config';
import type {
  BaseOptions,
  BaseResult,
  FormatOptions,
  FRPlaceholderType,
  GlobalOptions,
} from './core/types';
import useAsyncQuery from './core/useAsyncQuery';
import { get, isFunction, omit, warning } from './core/utils';
import generateService from './core/utils/generateService';
import type { ServiceParams } from './core/utils/types';

export interface LoadMoreResult<R, P extends unknown[], LR extends unknown[]>
  extends Omit<BaseResult<R, P>, 'queries' | 'refresh' | 'mutate'> {
  dataList: Ref<LR>;
  noMore: Ref<boolean>;
  loadingMore: Ref<boolean>;
  refreshing: Ref<boolean>;
  reloading: Ref<boolean>;
  loadMore: () => void;
  reload: () => void;
  refresh: () => void;
}

export type LoadMoreExtendsOption = {
  listKey?: string;
};

export type LoadMoreGenericExtendsOption<R> = {
  isNoMore?: (data: R) => boolean;
};

export type LoadMoreService<R, P extends unknown[], LR> =
  | ((r: { data: R; dataList: LR }, ...args: P) => Promise<R>)
  | ((r: { data: R; dataList: LR }, ...args: P) => ServiceParams);

export type LoadMoreFormatOptions<R, P extends unknown[], FR> = Omit<
  FormatOptions<R, P, FR>,
  'queryKey'
> &
  LoadMoreGenericExtendsOption<R> &
  LoadMoreExtendsOption;

export type LoadMoreBaseOptions<R, P extends unknown[]> = Omit<
  BaseOptions<R, P>,
  'queryKey'
> &
  LoadMoreGenericExtendsOption<R> &
  LoadMoreExtendsOption;

export type LoadMoreMixinOptions<R, P extends unknown[], FR> =
  | LoadMoreBaseOptions<R, P>
  | LoadMoreFormatOptions<R, P, FR>;

function useLoadMore<
  R,
  P extends unknown[] = any,
  LR extends unknown[] = any[]
>(service: LoadMoreService<R, P, LR>): LoadMoreResult<R, P, LR>;
function useLoadMore<
  R,
  P extends unknown[] = any,
  FR = FRPlaceholderType,
  LR extends unknown[] = any[]
>(
  service: LoadMoreService<R, P, LR>,
  options: LoadMoreFormatOptions<R, P, FR>,
): LoadMoreResult<FR, P, LR>;
function useLoadMore<
  R,
  P extends unknown[] = any,
  LR extends unknown[] = any[]
>(
  service: LoadMoreService<R, P, LR>,
  options: LoadMoreBaseOptions<R, P>,
): LoadMoreResult<R, P, LR>;
function useLoadMore<R, P extends unknown[], FR, LR extends unknown[]>(
  service: LoadMoreService<R, P, LR>,
  options?: LoadMoreMixinOptions<R, P, FR>,
) {
  if (!isFunction(service)) {
    warning('useLoadMore only support function service');
  }
  const promiseQuery = generateService<R, P>(service as any);

  const injectedGlobalOptions = inject<GlobalOptions>(
    GLOBAL_OPTIONS_PROVIDE_KEY,
    {},
  );

  const {
    queryKey,
    isNoMore,
    listKey = 'list',
    ...restOptions
  } = Object.assign(
    {
      listKey: injectedGlobalOptions.listKey ?? getGlobalOptions().listKey,
    },
    options ?? ({} as any),
  );

  if (queryKey) {
    warning('useLoadMore does not support concurrent request');
  }

  const refreshing = ref(false);
  const loadingMore = ref(false);
  const reloading = ref(false);
  const initailIncreaseQueryKey = 0;
  const increaseQueryKey = ref(initailIncreaseQueryKey);
  const {
    data,
    params,
    queries,
    run,
    reset,
    cancel: _cancel,
    ...rest
  } = useAsyncQuery<R, P>(promiseQuery, {
    ...restOptions,
    onSuccess: (...p) => {
      loadingMore.value = false;
      increaseQueryKey.value++;
      restOptions?.onSuccess?.(...p);
    },
    onError: (...p) => {
      loadingMore.value = false;
      restOptions?.onError?.(...p);
    },
    queryKey: () => String(increaseQueryKey.value),
  });

  const latestData = ref(data.value) as Ref<R | undefined>;
  watchEffect(() => {
    if (data.value !== undefined) {
      latestData.value = data.value;
    }
  });

  const noMore = computed(() => {
    return isNoMore && isFunction(isNoMore)
      ? isNoMore(latestData.value)
      : false;
  });

  const dataList = computed(() => {
    let list: any[] = [];
    Object.values(queries).forEach(h => {
      const dataList = get(h.data!, listKey);
      if (dataList && Array.isArray(dataList)) {
        list = list.concat(dataList);
      }
    });
    return (list as unknown) as LR;
  });

  const loadMore = () => {
    if (noMore.value) {
      return;
    }
    loadingMore.value = true;
    const [, ...restParams] = params.value;
    const mergerParams = [
      { dataList: dataList.value, data: latestData.value },
      ...restParams,
    ] as P;
    run(...mergerParams);
  };

  const unmountQueries = () => {
    Object.keys(queries).forEach(key => {
      if (key !== initailIncreaseQueryKey.toString()) {
        queries[key].cancel();
        queries[key].unmount();
        delete queries[key];
      }
    });
  };

  const refresh = async () => {
    refreshing.value = true;
    const latestKey = increaseQueryKey.value - 1;
    const key =
      latestKey < initailIncreaseQueryKey ? initailIncreaseQueryKey : latestKey;

    latestData.value = queries[key].data;
    increaseQueryKey.value = initailIncreaseQueryKey;
    const [, ...restParams] = params.value;
    const mergerParams = [undefined, ...restParams] as any;
    await run(...mergerParams);
    unmountQueries();
    refreshing.value = false;
  };

  const reload = async () => {
    reloading.value = true;
    reset();
    increaseQueryKey.value = initailIncreaseQueryKey;
    latestData.value = undefined;
    const [, ...restParams] = params.value;
    const mergerParams = [undefined, ...restParams] as any;
    await run(...mergerParams);
    reloading.value = false;
  };

  const cancel = () => {
    _cancel();
    loadingMore.value = false;
    refreshing.value = false;
  };

  return {
    data: latestData,
    dataList: dataList,
    params,
    noMore,
    loadingMore,
    refreshing,
    reloading,
    run,
    reload,
    loadMore,
    reset,
    refresh,
    cancel,
    ...omit(rest, ['refresh', 'mutate']),
  };
}

export default useLoadMore;
