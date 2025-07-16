/**
 * 基于XState的成员基类
 *
 * 设计理念：
 * 1. 使用XState管理成员状态机
 * 2. 支持事件队列处理
 * 3. 根据成员类型生成对应属性
 * 4. 为扩展Player、Mob等子类提供基础架构
 * 5. 与GameEngine集成的事件系统
 */

import { setup, createActor, assign, fromPromise, fromCallback } from "xstate";
import type { MemberWithRelations } from "~/repositories/member";
import type { PlayerWithRelations } from "~/repositories/player";
import type { MercenaryWithRelations } from "~/repositories/mercenary";
import type { MobWithRelations } from "~/repositories/mob";
import { MEMBER_TYPE, type MemberType } from "~/../db/enums";

// ============================== 类型定义 ==============================

/**
 * 属性值类型枚举
 */
export enum ValueType {
  user = "user",
  system = "system",
}

/**
 * 目标类型枚举
 */
export enum TargetType {
  baseValue = "baseValue",
  staticConstant = "staticConstant",
  staticPercentage = "staticPercentage",
  dynamicConstant = "dynamicConstant",
  dynamicPercentage = "dynamicPercentage",
}

/**
 * 属性影响关系接口
 */
export interface AttributeInfluence {
  name: string; // 将影响的目标属性
  targetType: TargetType; // 作用的位置
  computation: () => number; // 作用的值
}

/**
 * 属性修改器
 */
export interface ModifiersData {
  static: {
    fixed: {
      value: number;
      origin: string;
    }[];
    percentage: {
      value: number;
      origin: string;
    }[];
  };
  dynamic: {
    fixed: {
      value: number;
      origin: string;
    }[];
    percentage: {
      value: number;
      origin: string;
    }[];
  };
}

/**
 * 玩家属性数据接口
 */
export interface AttrData {
  type: ValueType;
  name: string;
  baseValue:
    | number
    | Array<{
        value: number;
        sourceName: string;
        source: string;
      }>;
  modifiers: ModifiersData;
  influences: AttributeInfluence[];
}

/**
 * 成员基础属性接口
 * 定义所有成员类型共有的基础属性
 */
export interface MemberBaseStats {
  /** 最大生命值 */
  maxHp: number;
  /** 当前生命值 */
  currentHp: number;
  /** 最大魔法值 */
  maxMp: number;
  /** 当前魔法值 */
  currentMp: number;
  /** 物理攻击力 */
  physicalAtk: number;
  /** 魔法攻击力 */
  magicalAtk: number;
  /** 物理防御力 */
  physicalDef: number;
  /** 魔法防御力 */
  magicalDef: number;
  /** 攻击速度 */
  aspd: number;
  /** 移动速度 */
  mspd: number;
  /** 位置坐标 */
  position: { x: number; y: number };
}

/**
 * 成员状态机上下文接口
 * 定义状态机运行时的上下文数据
 */
export interface MemberContext {
  /** 成员基础数据（来自数据库） */
  memberData: MemberWithRelations;
  /** 成员基础属性 */
  stats: MemberBaseStats;
  /** 是否存活 */
  isAlive: boolean;
  /** 是否可行动 */
  isActive: boolean;
  /** 当前状态效果 */
  statusEffects: string[];
  /** 事件队列 */
  eventQueue: MemberEvent[];
  /** 最后更新时间戳 */
  lastUpdateTimestamp: number;
  /** 额外数据 */
  extraData: Record<string, any>;
}

/**
 * 成员事件接口
 * 定义成员状态机可以处理的事件类型
 */
export interface MemberEvent {
  /** 事件ID */
  id: string;
  /** 事件类型 */
  type: string;
  /** 事件时间戳 */
  timestamp: number;
  /** 事件数据 */
  data?: Record<string, any>;
}

/**
 * 成员事件类型枚举
 */
export type MemberEventType =
  | "spawn" // 生成事件
  | "death" // 死亡事件
  | "damage" // 受到伤害
  | "heal" // 治疗事件
  | "skill_start" // 技能开始
  | "skill_end" // 技能结束
  | "move" // 移动事件
  | "status_effect" // 状态效果
  | "update" // 更新事件
  | "custom"; // 自定义事件

// ============================== 类型守卫函数 ==============================

/**
 * 类型守卫：检查成员是否为玩家类型
 */
export function isPlayerMember(
  member: MemberWithRelations,
): member is MemberWithRelations & { player: NonNullable<MemberWithRelations["player"]> } {
  return member.player !== null && member.player !== undefined;
}

/**
 * 类型守卫：检查成员是否为佣兵类型
 */
export function isMercenaryMember(
  member: MemberWithRelations,
): member is MemberWithRelations & { mercenary: NonNullable<MemberWithRelations["mercenary"]> } {
  return member.mercenary !== null && member.mercenary !== undefined;
}

/**
 * 类型守卫：检查成员是否为怪物类型
 */
export function isMobMember(
  member: MemberWithRelations,
): member is MemberWithRelations & { mob: NonNullable<MemberWithRelations["mob"]> } {
  return member.mob !== null && member.mob !== undefined;
}

/**
 * 类型守卫：检查成员是否为伙伴类型
 */
export function isPartnerMember(
  member: MemberWithRelations,
): member is MemberWithRelations & { partner: NonNullable<MemberWithRelations["partner"]> } {
  return member.partner !== null && member.partner !== undefined;
}

// ============================== 成员基类 ==============================

/**
 * 成员基类
 * 提供基于XState的状态机管理和事件队列处理
 */
export abstract class Member {
  // ==================== 核心属性 ====================

  /** 成员唯一标识符 */
  protected readonly id: string;

  /** 成员类型 */
  protected readonly type: MemberType;

  /** 成员目标 */
  protected target: Member | null = null;

  /** XState状态机实例 */
  protected actor: any;

  /** 事件队列 */
  protected eventQueue: MemberEvent[] = [];

  /** 最后更新时间戳 */
  protected lastUpdateTimestamp: number = 0;

  // ==================== 静态参数统计方法 ====================

  /** 计算属性基础值 */
  static baseValue = (m: AttrData | undefined): number => {
    if (!m) throw new Error("传入的属性无法计算");
    if (typeof m.baseValue === "number") return m.baseValue;
    let sum = 0;
    for (let i = 0; i < m.baseValue.length; i++) {
      sum += m.baseValue[i].value;
    }
    return sum;
  };

  /** 计算静态固定值 */
  static staticFixedValue = (m: AttrData): number => {
    const fixedArray = m.modifiers.static.fixed.map((mod) => mod.value);
    return fixedArray.reduce((a, b) => a + b, 0);
  };

  /** 计算动态固定值 */
  static dynamicFixedValue = (m: AttrData): number => {
    let value = 0;
    if (m.modifiers.dynamic?.fixed) {
      const fixedArray = m.modifiers.dynamic.fixed.map((mod) => mod.value);
      value = fixedArray.reduce((a, b) => a + b, 0) + this.staticFixedValue(m);
    }
    return value;
  };

  /** 计算静态百分比值 */
  static staticPercentageValue = (m: AttrData): number => {
    const percentageArray = m.modifiers.static.percentage.map((mod) => mod.value);
    return percentageArray.reduce((a, b) => a + b, 0);
  };

  /** 计算动态百分比值 */
  static dynamicPercentageValue = (m: AttrData): number => {
    let value = 0;
    if (m.modifiers.dynamic?.percentage) {
      const percentageArray = m.modifiers.dynamic.percentage.map((mod) => mod.value);
      value = percentageArray.reduce((a, b) => a + b, 0) + this.staticPercentageValue(m);
    }
    return value;
  };

  /** 计算静态总值 */
  static staticTotalValue = (m: AttrData): number => {
    const base = this.baseValue(m);
    const fixed = this.staticFixedValue(m);
    const percentage = this.staticPercentageValue(m);
    return base * (1 + percentage / 100) + fixed;
  };

  /** 计算动态总值 */
  static dynamicTotalValue = (m: AttrData | undefined): number => {
    if (!m) throw new Error("传入的属性无法计算");
    const base = this.baseValue(m);
    const fixed = this.dynamicFixedValue(m);
    const percentage = this.dynamicPercentageValue(m);
    return Math.floor(base * (1 + percentage / 100) + fixed);
  };

  // ==================== 构造函数 ====================

  /**
   * 构造函数
   *
   * @param memberData 成员基础数据
   * @param initialState 初始状态配置
   */
  constructor(
    protected readonly memberData: MemberWithRelations,
    initialState: {
      position?: { x: number; y: number };
      currentHp?: number;
      currentMp?: number;
    } = {},
  ) {
    this.id = memberData.id;
    this.type = memberData.type;

    // 创建状态机实例
    this.actor = createActor(this.createStateMachine(initialState));

    // 启动状态机
    this.actor.start();

    console.log(`🎭 创建成员: ${memberData.name} (${this.type})`);
  }

  // ==================== 抽象方法 ====================

  /**
   * 计算成员基础属性
   * 子类必须实现此方法来根据具体类型计算属性
   *
   * @param memberData 成员数据
   * @param initialState 初始状态
   * @returns 计算后的基础属性
   */
  protected abstract calculateBaseStats(
    memberData: MemberWithRelations,
    initialState: { currentHp?: number; currentMp?: number },
  ): MemberBaseStats;

  /**
   * 处理成员特定事件
   * 子类可以重写此方法来处理特定类型的事件
   *
   * @param event 事件对象
   */
  protected abstract handleSpecificEvent(event: MemberEvent): void;

  // ==================== 公共接口 ====================

  /**
   * 获取成员ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * 获取成员类型
   */
  getType(): MemberType {
    return this.type;
  }

  /**
   * 获取成员名称
   */
  getName(): string {
    return this.memberData.name;
  }

  /**
   * 获取当前状态
   */
  getCurrentState(): any {
    return this.actor.getSnapshot();
  }

  /**
   * 获取成员属性
   */
  getStats(): MemberBaseStats {
    return this.actor.getSnapshot().context.stats;
  }

  /**
   * 检查是否存活
   */
  isAlive(): boolean {
    return this.actor.getSnapshot().context.isAlive;
  }

  /**
   * 检查是否可行动
   */
  isActive(): boolean {
    return this.actor.getSnapshot().context.isActive;
  }

  /**
   * 添加事件到队列
   *
   * @param event 要添加的事件
   */
  addEvent(event: MemberEvent): void {
    this.eventQueue.push(event);
    console.log(`📝 添加事件到队列: ${this.getName()} -> ${event.type}`);
  }

  /**
   * 处理事件队列
   * 处理所有待处理的事件
   *
   * @param currentTimestamp 当前时间戳
   */
  processEventQueue(currentTimestamp: number): void {
    const eventsToProcess = this.eventQueue.filter((event) => event.timestamp <= currentTimestamp);

    for (const event of eventsToProcess) {
      this.processEvent(event);
    }

    // 移除已处理的事件
    this.eventQueue = this.eventQueue.filter((event) => event.timestamp > currentTimestamp);

    this.lastUpdateTimestamp = currentTimestamp;
  }

  /**
   * 更新成员状态
   *
   * @param currentTimestamp 当前时间戳
   */
  update(currentTimestamp: number): void {
    // 处理事件队列
    this.processEventQueue(currentTimestamp);

    // 发送更新事件到状态机
    this.actor.send({ type: "update", timestamp: currentTimestamp });

    // 调用子类特定的更新逻辑
    this.onUpdate(currentTimestamp);
  }

  /**
   * 受到伤害
   *
   * @param damage 伤害值
   * @param damageType 伤害类型
   * @param sourceId 伤害来源ID
   */
  takeDamage(damage: number, damageType: "physical" | "magical" = "physical", sourceId?: string): void {
    const event: MemberEvent = {
      id: `damage_${Date.now()}_${Math.random()}`,
      type: "damage",
      timestamp: this.lastUpdateTimestamp,
      data: { damage, damageType, sourceId },
    };

    this.addEvent(event);
  }

  /**
   * 受到治疗
   *
   * @param heal 治疗值
   * @param sourceId 治疗来源ID
   */
  takeHeal(heal: number, sourceId?: string): void {
    const event: MemberEvent = {
      id: `heal_${Date.now()}_${Math.random()}`,
      type: "heal",
      timestamp: this.lastUpdateTimestamp,
      data: { heal, sourceId },
    };

    this.addEvent(event);
  }

  /**
   * 移动到指定位置
   *
   * @param position 目标位置
   */
  moveTo(position: { x: number; y: number }): void {
    const event: MemberEvent = {
      id: `move_${Date.now()}_${Math.random()}`,
      type: "move",
      timestamp: this.lastUpdateTimestamp,
      data: { position },
    };

    this.addEvent(event);
  }

  /**
   * 使用技能
   *
   * @param skillId 技能ID
   * @param targetId 目标ID
   */
  useSkill(skillId: string): void {
    const event: MemberEvent = {
      id: `skill_${Date.now()}_${Math.random()}`,
      type: "skill_start",
      timestamp: this.lastUpdateTimestamp,
      data: { skillId, target: this.target },
    };

    this.addEvent(event);
  }

  // ==================== 受保护的方法 ====================

  /**
   * 创建XState状态机
   *
   * @param initialState 初始状态配置
   * @returns 状态机配置
   */
  protected createStateMachine(initialState: {
    position?: { x: number; y: number };
    currentHp?: number;
    currentMp?: number;
  }) {
    // 计算基础属性
    const baseStats = this.calculateBaseStats(this.memberData, initialState);

    return setup({
      types: {
        context: {} as MemberContext,
        events: {} as
          | { type: "spawn" }
          | { type: "death" }
          | { type: "damage"; data: { damage: number; damageType: string; sourceId?: string } }
          | { type: "heal"; data: { heal: number; sourceId?: string } }
          | { type: "skill_start"; data: { skillId: string; targetId?: string } }
          | { type: "skill_end" }
          | { type: "move"; data: { position: { x: number; y: number } } }
          | { type: "status_effect"; data: { effect: string; duration: number } }
          | { type: "update"; timestamp: number }
          | { type: "custom"; data: Record<string, any> },
      },
      actions: {
        // 初始化成员状态
        initializeMember: assign({
          stats: ({ context }) => baseStats,
          isAlive: true,
          isActive: true,
          statusEffects: [],
          eventQueue: [],
          lastUpdateTimestamp: 0,
          extraData: {},
        }),

        // 处理伤害
        handleDamage: assign({
          stats: ({ context, event }) => {
            if (event.type !== "damage") return context.stats;

            const { damage } = (event as any).data || {};
            const newHp = Math.max(0, context.stats.currentHp - damage);

            return {
              ...context.stats,
              currentHp: newHp,
            };
          },
        }),

        // 处理治疗
        handleHeal: assign({
          stats: ({ context, event }) => {
            if (event.type !== "heal") return context.stats;

            const { heal } = (event as any).data || {};
            const newHp = Math.min(context.stats.maxHp, context.stats.currentHp + heal);

            return {
              ...context.stats,
              currentHp: newHp,
            };
          },
        }),

        // 处理移动
        handleMove: assign({
          stats: ({ context, event }) => {
            if (event.type !== "move") return context.stats;

            return {
              ...context.stats,
              position: (event as any).data?.position || context.stats.position,
            };
          },
        }),

        // 处理死亡
        handleDeath: assign({
          isAlive: false,
          isActive: false,
        }),

        // 记录事件
        logEvent: ({ context, event }) => {
          console.log(`🎭 [${context.memberData.name}] 事件: ${event.type}`, (event as any).data || "");
        },
      },
      guards: {
        // 检查是否死亡
        isDead: ({ context }) => context.stats.currentHp <= 0,

        // 检查是否存活
        isAlive: ({ context }) => context.stats.currentHp > 0,
      },
    }).createMachine({
      id: `Member_${this.id}`,
      context: {
        memberData: this.memberData,
        stats: baseStats,
        isAlive: true,
        isActive: true,
        statusEffects: [],
        eventQueue: [],
        lastUpdateTimestamp: 0,
        extraData: {},
      },
      initial: "alive",
      entry: {
        type: "initializeMember",
      },
      states: {
        alive: {
          initial: "active",
          on: {
            death: {
              target: "dead",
              actions: ["handleDeath", "logEvent"],
            },
            damage: [
              {
                target: "dead",
                guard: "isDead",
                actions: ["handleDamage", "handleDeath", "logEvent"],
              },
              {
                actions: ["handleDamage", "logEvent"],
              },
            ],
            heal: {
              actions: ["handleHeal", "logEvent"],
            },
            move: {
              actions: ["handleMove", "logEvent"],
            },
            skill_start: {
              actions: ["logEvent"],
            },
            skill_end: {
              actions: ["logEvent"],
            },
            status_effect: {
              actions: ["logEvent"],
            },
            update: {
              actions: ["logEvent"],
            },
            custom: {
              actions: ["logEvent"],
            },
          },
          states: {
            active: {
              description: "成员可行动状态",
            },
            stunned: {
              description: "成员被击晕状态",
            },
            casting: {
              description: "成员施法状态",
            },
          },
        },
        dead: {
          description: "成员死亡状态",
          on: {
            // 可以添加复活相关事件
          },
        },
      },
    });
  }

  /**
   * 处理单个事件
   *
   * @param event 要处理的事件
   */
  protected processEvent(event: MemberEvent): void {
    // 发送事件到状态机
    this.actor.send(event);

    // 调用子类特定的处理逻辑
    this.handleSpecificEvent(event);
  }

  /**
   * 更新回调
   * 子类可以重写此方法来实现特定的更新逻辑
   *
   * @param currentTimestamp 当前时间戳
   */
  protected onUpdate(currentTimestamp: number): void {
    // 默认实现为空，子类可以重写
  }

  // ==================== 工具方法 ====================

  /**
   * 获取成员信息摘要
   */
  getSummary(): string {
    const stats = this.getStats();
    const state = this.getCurrentState();

    return `${this.getName()} (${this.type}) - HP: ${stats.currentHp}/${stats.maxHp} - 状态: ${state.value}`;
  }

  /**
   * 销毁成员
   * 清理资源并停止状态机
   */
  destroy(): void {
    this.actor.stop();
    this.eventQueue = [];
    console.log(`🗑️ 销毁成员: ${this.getName()}`);
  }
}

// ============================== 工厂函数 ==============================

/**
 * 创建成员实例的工厂函数
 * 根据成员类型创建对应的成员实例
 *
 * @param memberData 成员数据
 * @param initialState 初始状态
 * @returns 成员实例
 */
export function createMember(
  memberData: MemberWithRelations,
  initialState: {
    position?: { x: number; y: number };
    currentHp?: number;
    currentMp?: number;
  } = {},
): Member {
  // 根据成员类型创建对应的子类实例
  switch (memberData.type) {
    case "Player":
      // 导入Player类并创建实例
      const { Player } = require("./Player");
      return new Player(memberData, initialState);

    case "Mob":
      // TODO: 创建Mob类实例
      // const { Mob } = require("./Mob");
      // return new Mob(memberData, initialState);
      break;

    case "Mercenary":
      // TODO: 创建Mercenary类实例
      // const { Mercenary } = require("./Mercenary");
      // return new Mercenary(memberData, initialState);
      break;

    case "Partner":
      // TODO: 创建Partner类实例
      // const { Partner } = require("./Partner");
      // return new Partner(memberData, initialState);
      break;

    default:
      throw new Error(`不支持的成员类型: ${memberData.type}`);
  }

  // 如果所有类型都不匹配，返回默认实现
  return new (class extends Member {
    protected calculateBaseStats(
      memberData: MemberWithRelations,
      initialState: { currentHp?: number; currentMp?: number },
    ): MemberBaseStats {
      // 默认属性计算逻辑
      let maxHp = 1000;
      let maxMp = 100;

      // 根据成员类型计算属性
      if (isPlayerMember(memberData)) {
        // 玩家角色：根据角色属性计算
        const character = memberData.player.character;
        if (character) {
          maxHp = character.vit * 10 + character.str * 5;
          maxMp = character.int * 8;
        }
      } else if (isMobMember(memberData)) {
        // 怪物：使用怪物的基础生命值
        maxHp = memberData.mob.maxhp;
        maxMp = 100;
      } else if (isMercenaryMember(memberData)) {
        // 佣兵：使用默认值
        maxHp = 800;
        maxMp = 80;
      } else if (isPartnerMember(memberData)) {
        // 伙伴：使用默认值
        maxHp = 600;
        maxMp = 60;
      }

      return {
        maxHp,
        currentHp: initialState.currentHp ?? maxHp,
        maxMp,
        currentMp: initialState.currentMp ?? maxMp,
        physicalAtk: 100,
        magicalAtk: 50,
        physicalDef: 50,
        magicalDef: 50,
        aspd: 1.0,
        mspd: 1.0,
        position: { x: 0, y: 0 },
      };
    }

    protected handleSpecificEvent(event: MemberEvent): void {
      // 默认事件处理逻辑
      console.log(`🎭 [${this.getName()}] 处理特定事件: ${event.type}`);
    }
  })(memberData, initialState);
}

// ============================== 导出 ==============================

export default Member;
