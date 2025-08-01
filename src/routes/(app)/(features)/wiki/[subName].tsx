import { A, useNavigate, useParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  useContext,
} from "solid-js";
import { Motion, Presence } from "solid-motionone";
import { setStore, store } from "~/store";
import { getDictionary } from "~/locales/i18n";
import Icons from "~/components/icons/index";
import { Button } from "~/components/controls/button";
import { Portal } from "solid-js/web";
import { Sheet } from "~/components/containers/sheet";
import { LoadingBar } from "~/components/controls/loadingBar";
import { defaultData } from "@db/defaultData";
import { DB } from "@db/generated/kysely/kyesely";
import { dataDisplayConfig } from "./dataConfig/dataConfig";
import { VirtualTable } from "~/components/dataDisplay/virtualTable";
import { MediaContext } from "~/lib/contexts/Media";
import { Dialog } from "~/components/containers/dialog";
import { DBDataConfig } from "./dataConfig/dataConfig";
import { setWikiStore, wikiStore } from "./store";
import { getCardDatas } from "~/lib/utils/cardDataCache";
import { Card } from "~/components/containers/card";

export default function WikiSubPage() {
  // const start = performance.now();
  // console.log("WikiSubPage start", start);
  const media = useContext(MediaContext);
  // UI文本字典
  const dictionary = createMemo(() => getDictionary(store.settings.language));
  // url 参数
  const params = useParams();
  const navigate = useNavigate();

  // 状态管理参数
  const [isMainContentFullscreen, setIsMainContentFullscreen] = createSignal(false);
  const [activeBannerIndex, setActiveBannerIndex] = createSignal(0);

  const [dataConfig, setDataConfig] = createSignal<dataDisplayConfig<any, any, any>>();

  const [wikiSelectorIsOpen, setWikiSelectorIsOpen] = createSignal(false);

  const [cachedCardDatas, { refetch }] = createResource(
    () => wikiStore.cardGroup,
    (cardGroup) => getCardDatas(cardGroup),
  );

  // 监听url参数变化, 初始化页面状态
  createEffect(
    on(
      () => params.subName,
      () => {
        // const start = performance.now();
        // console.log("Effect start", start);
        console.log("Url参数：", params.subName);
        if (params.subName in defaultData) {
          const wikiType = params.subName as keyof DB;
          // 初始化页面状态
          setWikiStore("type", wikiType);
          setWikiStore("table", {
            globalFilterStr: "",
            columnVisibility: {},
            configSheetIsOpen: false,
          });
          setWikiStore("form", {
            data: undefined,
            isOpen: false,
          });
          setIsMainContentFullscreen(false);
          setActiveBannerIndex(0);
          setDataConfig(DBDataConfig[wikiType]);
        } else {
          navigate(`/404`);
        }
        // console.log("Effect end", performance.now() - start);
      },
    ),
  );

  // wiki 选择器(弹出层)配置
  const wikiSelectorConfig: {
    groupName: string;
    groupFields: {
      name: keyof DB;
      icon: JSX.Element;
    }[];
  }[] = [
    {
      groupName: dictionary().ui.wiki.selector.groupName.combat,
      groupFields: [
        {
          name: "mob",
          icon: <Icons.Filled.Browser />,
        },
        {
          name: "skill",
          icon: <Icons.Filled.Basketball />,
        },
        {
          name: "weapon",
          icon: <Icons.Filled.Box2 />,
        },
        {
          name: "armor",
          icon: <Icons.Filled.Category2 />,
        },
        {
          name: "option",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "special",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "crystal",
          icon: <Icons.Filled.Layers />,
        },
      ],
    },
    {
      groupName: dictionary().ui.wiki.selector.groupName.daily,
      groupFields: [
        {
          name: "address",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "zone",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "npc",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "consumable",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "material",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "task",
          icon: <Icons.Filled.Layers />,
        },
        {
          name: "activity",
          icon: <Icons.Filled.Layers />,
        },
      ],
    },
  ];

  onMount(() => {
    console.log(`--Wiki Page Mount`);
  });

  onCleanup(() => {
    console.log(`--Wiki Page Unmount`);
  });

  return (
    <Show when={dataConfig()}>
      {(validDataConfig) => (
        <Show
          when={store.database.tableSyncState[wikiStore.type]}
          fallback={
            <div class="LoadingState flex h-full w-full flex-col items-center justify-center gap-3">
              <LoadingBar class="w-1/2 min-w-[320px]" />
              <h1 class="animate-pulse">awaiting DB-{wikiStore.type} sync...</h1>
            </div>
          }
        >
          {/* 标题 */}
          <Presence exitBeforeEnter>
            <Show when={!isMainContentFullscreen()}>
              <Motion.div
                class="Title flex flex-col lg:pt-12 landscape:p-3"
                animate={{ opacity: [0, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: store.settings.userInterface.isAnimationEnabled ? 0.3 : 0 }}
              >
                <div class="Content flex flex-row items-center justify-between gap-4 px-6 py-0 lg:px-0 lg:py-3">
                  <h1 class="Text flex cursor-pointer items-center gap-3 text-left text-2xl font-black lg:bg-transparent lg:text-[2.5rem] lg:leading-[48px] lg:font-normal">
                    {dictionary().db[wikiStore.type].selfName}
                  </h1>
                  <input
                    id="DataSearchBox"
                    type="search"
                    placeholder={dictionary().ui.searchPlaceholder}
                    class="border-dividing-color placeholder:text-dividing-color hover:border-main-text-color focus:border-main-text-color hidden h-[50px] w-full flex-1 rounded-none border-b-1 bg-transparent px-3 py-2 backdrop-blur-xl focus:outline-hidden lg:block lg:h-[48px] lg:flex-1 lg:px-5 lg:font-normal"
                    onInput={(e) => {
                      setWikiStore("table", {
                        globalFilterStr: e.target.value,
                      });
                    }}
                  />
                  <div class="FunctionGroup flex">
                    <Button // 仅移动端显示
                      size="sm"
                      icon={<Icons.Outline.CloudUpload />}
                      class="flex bg-transparent lg:hidden"
                      onClick={() => {
                        setWikiStore("form", {
                          isOpen: true,
                        });
                      }}
                    ></Button>
                    <Button // 仅移动端显示
                      size="sm"
                      icon={<Icons.Outline.InfoCircle />}
                      class="flex bg-transparent lg:hidden"
                      onClick={() => {}}
                    ></Button>
                    <Show when={store.session.user.id}>
                      <Button // 仅PC端显示
                        icon={<Icons.Outline.CloudUpload />}
                        class="hidden lg:flex"
                        onClick={() => {
                          setWikiStore("form", {
                            isOpen: true,
                          });
                        }}
                      >
                        {dictionary().ui.actions.add}
                      </Button>
                    </Show>
                  </div>
                </div>
              </Motion.div>
            </Show>
          </Presence>

          {/* 轮播图 */}
          <Presence exitBeforeEnter>
            <Show when={!isMainContentFullscreen()}>
              <Motion.div
                class="Banner hidden h-[260px] flex-initial gap-3 p-3 opacity-0 lg:flex"
                animate={{ opacity: [0, 1] }}
                exit={{ opacity: [1, 0] }}
                transition={{ duration: store.settings.userInterface.isAnimationEnabled ? 0.3 : 0 }}
              >
                <div class="BannerContent flex flex-1 gap-6 lg:gap-2">
                  <For each={[0, 1, 2]}>
                    {(_, index) => {
                      const brandColor = {
                        1: "1st",
                        2: "2nd",
                        3: "3rd",
                      }[1 + (index() % 3)];
                      return (
                        <Presence exitBeforeEnter>
                          <Show when={!isMainContentFullscreen()}>
                            <Motion.div
                              class={`Banner-${index} flex-none overflow-hidden rounded border-2 ${activeBannerIndex() === index() ? "active shadow-card shadow-dividing-color border-primary-color" : "border-transparent"}`}
                              onMouseEnter={() => setActiveBannerIndex(index())}
                              style={{
                                // "background-image": `url(${mobList()?.[0]?.image.dataUrl !== `"data:image/png;base64,"` ? mobList()?.[0]?.image.dataUrl : defaultImage.dataUrl})`,
                                "background-position": "center center",
                              }}
                              animate={{
                                opacity: [0, 1],
                                transform: ["scale(0.9)", "scale(1)"],
                              }}
                              exit={{
                                opacity: [1, 0],
                                transform: ["scale(1)", "scale(0.9)"],
                              }}
                              transition={{
                                duration: store.settings.userInterface.isAnimationEnabled ? 0.7 : 0,
                                delay: index() * 0.05,
                              }}
                            >
                              <div
                                class={`mask ${activeBannerIndex() === index() ? `bg-brand-color-${brandColor}` : `bg-area-color`} text-primary-color hidden h-full flex-col justify-center gap-2 p-8 lg:flex`}
                              >
                                <span
                                  class={`text-3xl font-bold ${activeBannerIndex() === index() ? `text-primary-color` : `text-accent-color`}`}
                                >
                                  TOP.{index() + 1}
                                </span>
                                <div
                                  class={`h-[1px] w-[110px] ${activeBannerIndex() === index() ? `bg-primary-color` : `bg-accent-color`}`}
                                ></div>
                                <span
                                  class={`text-xl ${activeBannerIndex() === index() ? `text-primary-color` : `text-accent-color`}`}
                                >
                                  {/* {"name" in defaultData[tableName()] ? dataConfig().table.dataList?.latest?.[index()].name : ""} */}
                                </span>
                              </div>
                            </Motion.div>
                          </Show>
                        </Presence>
                      );
                    }}
                  </For>
                </div>
              </Motion.div>
            </Show>
          </Presence>

          {/* 表格和新闻 */}
          <div class="Table&News flex h-full flex-1 flex-col gap-3 overflow-hidden lg:flex-row lg:p-3">
            <div class="TableModule flex flex-1 flex-col overflow-hidden">
              <div class="Title hidden h-12 w-full items-center gap-3 lg:flex">
                <div class={`Text px-6 text-xl`}>{dictionary().db[wikiStore.type].selfName}</div>
                <div
                  class={`Description ${!isMainContentFullscreen() ? "opacity-0" : "opacity-100"} bg-area-color flex-1 rounded p-3`}
                >
                  {dictionary().db[wikiStore.type].description}
                </div>
                <Button
                  level="quaternary"
                  icon={isMainContentFullscreen() ? <Icons.Outline.Collapse /> : <Icons.Outline.Expand />}
                  onClick={() => {
                    setIsMainContentFullscreen((pre) => !pre);
                  }}
                />
              </div>
              <Show
                when={validDataConfig().main}
                fallback={VirtualTable({
                  dataFetcher: validDataConfig().table.dataFetcher,
                  columnsDef: validDataConfig().table.columnsDef,
                  hiddenColumnDef: validDataConfig().table.hiddenColumnDef,
                  tdGenerator: validDataConfig().table.tdGenerator,
                  defaultSort: validDataConfig().table.defaultSort,
                  dictionary: validDataConfig().table.dictionary(dictionary()),
                  globalFilterStr: () => wikiStore.table.globalFilterStr,
                  columnHandleClick: (id) => setWikiStore("cardGroup", (pre) => [...pre, { type: wikiStore.type, id }]),
                  columnVisibility: wikiStore.table.columnVisibility,
                  onColumnVisibilityChange: (updater) => {
                    if (typeof updater === "function") {
                      setWikiStore("table", {
                        columnVisibility: updater(wikiStore.table.columnVisibility),
                      });
                    }
                  },
                })}
              >
                {validDataConfig().main?.(dictionary(), (id) =>
                  setWikiStore("cardGroup", (pre) => [...pre, { type: wikiStore.type, id }]),
                )}
              </Show>
            </div>
            <Presence exitBeforeEnter>
              <Show when={!isMainContentFullscreen()}>
                <Motion.div
                  animate={{ opacity: [0, 1] }}
                  exit={{ opacity: 0 }}
                  class="News hidden w-[248px] flex-initial flex-col gap-2 lg:flex"
                >
                  <div class="Title flex h-12 text-xl">{dictionary().ui.wiki.news.title}</div>
                  <div class="Content flex flex-1 flex-col gap-3">
                    <For each={[0, 1, 2]}>
                      {(_, index) => {
                        return (
                          <Motion.div
                            class="Item bg-area-color h-full w-full flex-1 rounded"
                            animate={{
                              opacity: [0, 1],
                              transform: ["scale(0.9)", "scale(1)"],
                            }}
                            exit={{
                              opacity: [1, 0],
                              transform: ["scale(1)", "scale(0.9)"],
                            }}
                            transition={{
                              duration: store.settings.userInterface.isAnimationEnabled ? 0.7 : 0,
                              delay: index() * 0.05,
                            }}
                          ></Motion.div>
                        );
                      }}
                    </For>
                  </div>
                </Motion.div>
              </Show>
            </Presence>
          </div>

          {/* 控制栏 */}
          <Presence exitBeforeEnter>
            <Show when={isMainContentFullscreen() || media.width < 1024}>
              <Motion.div
                class="Control bg-primary-color shadow-dividing-color shadow-dialog absolute bottom-3 left-1/2 z-10 flex w-1/2 min-w-80 gap-1 rounded p-1 lg:min-w-2xl landscape:bottom-6"
                animate={{
                  opacity: [0, 1],
                  transform: ["translateX(-50%)", "translateX(-50%)"],
                }}
                exit={{ opacity: 0, transform: "translateX(-50%)" }}
                transition={{ duration: store.settings.userInterface.isAnimationEnabled ? 0.3 : 0 }}
              >
                <Show when={store.session.user.id}>
                  <Button
                    size="sm"
                    class="bg-transparent"
                    icon={<Icons.Outline.Swap />}
                    onClick={() => setWikiSelectorIsOpen((pre) => !pre)}
                  ></Button>
                </Show>
                <input
                  id="filterInput"
                  type="text"
                  placeholder={dictionary().ui.actions.filter}
                  value={wikiStore.table.globalFilterStr}
                  tabIndex={1}
                  onInput={(e) => {
                    setWikiStore("table", {
                      globalFilterStr: e.target.value,
                    });
                  }}
                  class="focus:placeholder:text-accent-color bg-area-color placeholder:text-boundary-color w-full flex-1 rounded px-4 py-2 text-lg font-bold mix-blend-multiply outline-hidden! placeholder:text-base placeholder:font-normal focus-within:outline-hidden landscape:flex landscape:bg-transparent dark:mix-blend-normal"
                />
                <Button
                  size="sm"
                  class="bg-transparent"
                  onclick={() => {
                    setWikiStore("table", {
                      configSheetIsOpen: !wikiStore.table.configSheetIsOpen,
                    });
                  }}
                  icon={<Icons.Outline.Settings />}
                />
              </Motion.div>
            </Show>
          </Presence>

          {/* 表单 */}
          <Portal>
            <Sheet state={wikiStore.form.isOpen} setState={(state) => setWikiStore("form", { isOpen: state })}>
              {validDataConfig().form({
                data: wikiStore.form.data,
                dic: dictionary(),
              })}
            </Sheet>
          </Portal>

          {/* 卡片组 */}
          <Portal>
            <Presence exitBeforeEnter>
              <Show when={cachedCardDatas()?.length}>
                <Motion.div
                  animate={{ transform: ["scale(1.05)", "scale(1)"], opacity: [0, 1] }}
                  exit={{ transform: ["scale(1)", "scale(1.05)"], opacity: [1, 0] }}
                  transition={{ duration: store.settings.userInterface.isAnimationEnabled ? 0.3 : 0 }}
                  class={`DialogBG bg-primary-color-10 fixed top-0 left-0 z-40 grid h-dvh w-dvw transform place-items-center backdrop-blur`}
                  onClick={() => setWikiStore("cardGroup", (pre) => pre.slice(0, -1))}
                >
                  <Index each={cachedCardDatas()}>
                    {(cardData, index) => {
                      return (
                        <Card
                          display={cachedCardDatas()!.length - index < 5}
                          title={
                            cardData() && "name" in cardData()
                              ? (cardData()["name"] as string)
                              : dictionary().db[wikiStore.cardGroup[index]?.type as keyof DB].selfName
                          }
                          index={index}
                          total={cachedCardDatas()!.length}
                        >
                          <Show when={wikiStore.cardGroup[index]?.type}>
                            {(type) => {
                              return DBDataConfig[type() as keyof typeof DBDataConfig]?.card({
                                dic: dictionary(),
                                data: cardData(),
                              });
                            }}
                          </Show>
                        </Card>
                      );
                    }}
                  </Index>
                </Motion.div>
              </Show>
            </Presence>
          </Portal>

          {/* 表格配置 */}
          <Portal>
            <Dialog
              state={wikiStore.table.configSheetIsOpen}
              setState={(state) => setWikiStore("table", { configSheetIsOpen: state })}
              title={dictionary().ui.wiki.tableConfig.title}
            >
              <div class="flex h-52 w-2xs flex-col gap-3"></div>
            </Dialog>
          </Portal>

          {/* wiki选择器 */}
          <Portal>
            <Dialog
              state={wikiSelectorIsOpen()}
              setState={setWikiSelectorIsOpen}
              title={dictionary().ui.wiki.selector.title}
            >
              <div class="flex flex-col gap-3">
                <For each={wikiSelectorConfig}>
                  {(group, index) => {
                    return (
                      <div class="Group flex flex-col gap-2">
                        <div class="GroupTitle flex flex-col gap-3">
                          <h3 class="text-accent-color flex items-center gap-2 font-bold">
                            {group.groupName}
                            <div class="Divider bg-dividing-color h-[1px] w-full flex-1" />
                          </h3>
                        </div>
                        <div class="GroupContent flex flex-wrap gap-2">
                          <For each={group.groupFields}>
                            {(field, index) => {
                              return (
                                <A
                                  href={`/wiki/${field.name}`}
                                  onClick={() => {
                                    setWikiSelectorIsOpen(false);
                                  }}
                                  class="border-dividing-color flex w-[calc(33.333333%-8px)] flex-col items-center gap-2 rounded border px-2 py-3"
                                >
                                  {field.icon}
                                  <span class="text-nowrap overflow-ellipsis">
                                    {dictionary().db[field.name].selfName}
                                  </span>
                                </A>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Dialog>
          </Portal>
        </Show>
      )}
    </Show>
  );
}
