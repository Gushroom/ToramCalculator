/**
 * 时间推进器 - 推进帧循环和事件调度
 * 
 * 核心职责（根据架构文档）：
 * 1. 推进帧（如每 16ms）
 * 2. 调度事件执行、状态推进等
 * 3. 可按需加速或暂停
 * 
 * 设计理念：
 * - 时间驱动：以固定帧率推进游戏时间
 * - 事件调度：每帧处理事件队列中的事件
 * - 状态推进：调用成员更新和状态机推进
 * - 可控制：支持暂停、加速、减速等控制
 * - 低耦合：通过接口与EventQueue和MemberRegistry交互
 */

import { MemberRegistry } from "./MemberRegistry";
import { Member } from "./Member";
import type { EventQueue, QueueEvent, BaseEvent, EventHandler, ExecutionContext, EventResult } from "./EventQueue";


// ============================== 类型定义 ==============================

/**
 * 帧循环状态枚举
 */
export type FrameLoopState = 
  | "stopped"    // 已停止
  | "running"    // 运行中
  | "paused";    // 已暂停

/**
 * 帧循环配置接口
 */
export interface FrameLoopConfig {
  /** 目标帧率（FPS） */
  targetFPS: number;
  /** 帧间隔（毫秒） */
  frameInterval: number;
  /** 是否启用帧跳跃 */
  enableFrameSkip: boolean;
  /** 最大帧跳跃数 */
  maxFrameSkip: number;
  /** 是否启用性能监控 */
  enablePerformanceMonitoring: boolean;
  /** 时间倍率（用于变速播放） */
  timeScale: number;
  /** 最大事件处理数（每帧） */
  maxEventsPerFrame: number;
}

/**
 * 帧信息接口
 */
export interface FrameInfo {
  /** 帧号 */
  frameNumber: number;
  /** 当前时间戳 */
  timestamp: number;
  /** 帧间隔（实际） */
  deltaTime: number;
  /** 帧处理时间 */
  processingTime: number;
  /** 事件处理数量 */
  eventsProcessed: number;
  /** 成员更新数量 */
  membersUpdated: number;
}

/**
 * 性能统计接口
 */
export interface PerformanceStats {
  /** 平均帧率 */
  averageFPS: number;
  /** 平均帧处理时间 */
  averageFrameTime: number;
  /** 总帧数 */
  totalFrames: number;
  /** 总运行时间 */
  totalRunTime: number;
  /** 帧率历史（最近100帧） */
  fpsHistory: number[];
  /** 帧时间历史（最近100帧） */
  frameTimeHistory: number[];
  /** 事件处理统计 */
  eventStats: {
    totalEventsProcessed: number;
    averageEventsPerFrame: number;
    maxEventsPerFrame: number;
  };
}

// ============================== 帧循环类 ==============================

/**
 * 帧循环类
 * 负责推进游戏时间和调度事件
 */
export class FrameLoop {
  // ==================== 私有属性 ====================

  /** 帧循环状态 */
  private state: FrameLoopState = "stopped";

  /** 帧循环配置 */
  private config: FrameLoopConfig;

  /** 成员注册表引用 */
  private memberRegistry: MemberRegistry;

  /** 事件队列引用 */
  private eventQueue: EventQueue | null = null;

  /** 事件处理器注册表 */
  private eventHandlers: Map<string, EventHandler> = new Map();

  /** 状态变化回调（用于通知GameEngine） */
  private onStateChange?: (event: { type: string; data: any }) => void;

  /** 帧循环定时器ID */
  private frameTimer: number | null = null;

  /** 帧计数器 */
  private frameNumber: number = 0;

  /** 开始时间戳 */
  private startTime: number = 0;

  /** 上一帧时间戳 */
  private lastFrameTime: number = 0;

  /** 时间倍率（用于变速播放） */
  private timeScale: number = 1.0;

  /** 帧率控制相关 */
  private frameAccumulator: number = 0;
  private frameSkipCount: number = 0;

  /** 性能统计 */
  private performanceStats: PerformanceStats = {
    averageFPS: 0,
    averageFrameTime: 0,
    totalFrames: 0,
    totalRunTime: 0,
    fpsHistory: [],
    frameTimeHistory: [],
    eventStats: {
      totalEventsProcessed: 0,
      averageEventsPerFrame: 0,
      maxEventsPerFrame: 0
    }
  };

  /** 帧信息历史 */
  private frameHistory: FrameInfo[] = [];

  // ==================== 构造函数 ====================

  /**
   * 构造函数
   * 
   * @param memberRegistry 成员注册表
   * @param eventQueue 事件队列引用
   * @param config 帧循环配置
   */
  constructor(
    memberRegistry: MemberRegistry, 
    eventQueue: EventQueue | null = null,
    config: Partial<FrameLoopConfig> = {}
  ) {
    this.memberRegistry = memberRegistry;
    this.eventQueue = eventQueue;
    
    // 设置默认配置
    this.config = {
      targetFPS: 60,
      frameInterval: 1000 / 60, // 16.67ms
      enableFrameSkip: true,
      maxFrameSkip: 5,
      enablePerformanceMonitoring: true,
      timeScale: 1.0,
      maxEventsPerFrame: 100,
      ...config
    };

    this.timeScale = this.config.timeScale;

    // 根据目标帧率计算帧间隔
    this.config.frameInterval = 1000 / this.config.targetFPS;

    console.log("FrameLoop: 初始化完成", this.config);
  }

  // ==================== 公共接口 ====================

  /**
   * 启动帧循环
   */
  start(): void {
    if (this.state === "running") {
      console.warn("⚠️ 帧循环已在运行中");
      return;
    }

    this.state = "running";
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.frameNumber = 0;
    this.frameAccumulator = 0;
    this.frameSkipCount = 0;

    // 重置性能统计
    this.resetPerformanceStats();

    console.log(`⏱️ 启动帧循环 - 目标帧率: ${this.config.targetFPS} FPS`);
    this.scheduleNextFrame();
  }

  /**
   * 停止帧循环
   */
  stop(): void {
    if (this.state === "stopped") {
      console.warn("⚠️ 帧循环已停止");
      return;
    }

    this.state = "stopped";
    
    if (this.frameTimer !== null) {
      cancelAnimationFrame(this.frameTimer);
      this.frameTimer = null;
    }

    // 更新性能统计
    this.updatePerformanceStats();

    console.log(`⏹️ 停止帧循环 - 总帧数: ${this.frameNumber}, 运行时间: ${(performance.now() - this.startTime).toFixed(2)}ms`);
  }

  /**
   * 暂停帧循环
   */
  pause(): void {
    if (this.state !== "running") {
      console.warn("⚠️ 帧循环未运行，无法暂停");
      return;
    }

    this.state = "paused";
    
    if (this.frameTimer !== null) {
      cancelAnimationFrame(this.frameTimer);
      this.frameTimer = null;
    }

    console.log("⏸️ 帧循环已暂停");
  }

  /**
   * 恢复帧循环
   */
  resume(): void {
    if (this.state !== "paused") {
      console.warn("⚠️ 帧循环未暂停，无法恢复");
      return;
    }

    this.state = "running";
    this.lastFrameTime = performance.now();
    
    console.log("▶️ 帧循环已恢复");
    this.scheduleNextFrame();
  }

  /**
   * 单步执行
   */
  step(): void {
    if (this.state === "running") {
      console.warn("⚠️ 帧循环正在运行，无法单步执行");
      return;
    }

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    this.processFrame(deltaTime);
    console.log(`👆 单步执行完成 - 帧号: ${this.frameNumber}`);
  }

  /**
   * 设置时间倍率（变速播放）
   * 
   * @param scale 时间倍率（1.0=正常，2.0=2倍速，0.5=半速）
   */
  setTimeScale(scale: number): void {
    if (scale < 0) {
      console.warn("⚠️ 时间倍率不能为负数");
      return;
    }

    this.timeScale = scale;
    this.config.timeScale = scale;
    
    if (scale === 0) {
      this.pause();
    } else if (this.state === "paused" && scale > 0) {
      this.resume();
    }

    console.log(`⏱️ 设置时间倍率: ${scale}x`);
  }

  /**
   * 设置目标帧率
   * 
   * @param fps 目标帧率
   */
  setTargetFPS(fps: number): void {
    if (fps <= 0 || fps > 1000) {
      console.warn("⚠️ 无效的帧率设置:", fps);
      return;
    }

    this.config.targetFPS = fps;
    this.config.frameInterval = 1000 / fps;
    console.log(`⏱️ 目标帧率已更新: ${fps} FPS`);
  }

  /**
   * 注册事件处理器
   * 
   * @param eventType 事件类型
   * @param handler 事件处理器
   */
  registerEventHandler(eventType: string, handler: EventHandler): void {
    this.eventHandlers.set(eventType, handler);
    // console.log(`📝 注册事件处理器: ${eventType}`);
  }

  /**
   * 注销事件处理器
   * 
   * @param eventType 事件类型
   */
  unregisterEventHandler(eventType: string): void {
    this.eventHandlers.delete(eventType);
    console.log(`🗑️ 注销事件处理器: ${eventType}`);
  }

  /**
   * 设置事件队列
   * 
   * @param eventQueue 事件队列
   */
  setEventQueue(eventQueue: EventQueue): void {
    this.eventQueue = eventQueue;
    console.log("🔗 设置事件队列");
  }

  /**
   * 设置状态变化回调
   * 
   * @param callback 状态变化回调函数
   */
  setStateChangeCallback(callback: (event: { type: string; data: any }) => void): void {
    this.onStateChange = callback;
  }

  /**
   * 获取当前状态
   * 
   * @returns 当前帧循环状态
   */
  getState(): FrameLoopState {
    return this.state;
  }

  /**
   * 获取当前帧号
   * 
   * @returns 当前帧号
   */
  getFrameNumber(): number {
    return this.frameNumber;
  }

  /**
   * 获取性能统计
   * 
   * @returns 性能统计信息
   */
  getPerformanceStats(): PerformanceStats {
    return { ...this.performanceStats };
  }

  /**
   * 获取帧历史
   * 
   * @returns 帧信息历史
   */
  getFrameHistory(): FrameInfo[] {
    return [...this.frameHistory];
  }

  /**
   * 检查是否正在运行
   * 
   * @returns 是否正在运行
   */
  isRunning(): boolean {
    return this.state === "running";
  }

  /**
   * 检查是否已暂停
   * 
   * @returns 是否已暂停
   */
  isPaused(): boolean {
    return this.state === "paused";
  }

  // ==================== 私有方法 ====================

  /**
   * 调度下一帧
   */
  private scheduleNextFrame(): void {
    if (this.state !== "running") {
      return;
    }

    this.frameTimer = requestAnimationFrame((timestamp) => {
      this.processFrameLoop(timestamp);
    });
  }

  /**
   * 主帧循环
   * 
   * @param timestamp 当前时间戳
   */
  private processFrameLoop(timestamp: number): void {
    if (this.state !== "running") {
      return;
    }

    const deltaTime = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // 应用时间倍率
    const scaledDeltaTime = deltaTime * this.timeScale;

    // 帧率控制
    this.frameAccumulator += scaledDeltaTime;

    // 处理帧跳跃
    if (this.config.enableFrameSkip && this.frameAccumulator > this.config.frameInterval * this.config.maxFrameSkip) {
      this.frameSkipCount++;
      this.frameAccumulator = this.config.frameInterval;
      console.log(`⏭️ 帧跳跃 - 跳过 ${this.config.maxFrameSkip} 帧`);
    }

    // 处理帧
    while (this.frameAccumulator >= this.config.frameInterval) {
      this.processFrame(this.config.frameInterval);
      this.frameAccumulator -= this.config.frameInterval;
    }

    // 调度下一帧
    this.scheduleNextFrame();
  }

  /**
   * 处理单帧逻辑
   * 
   * @param deltaTime 帧间隔时间
   */
  private processFrame(deltaTime: number): void {
    const frameStartTime = performance.now();
    
    // 增加帧计数
    this.frameNumber++;

    let eventsProcessed = 0;
    let membersUpdated = 0;

    try {
      // 1. 处理事件队列
      if (this.eventQueue) {
        eventsProcessed = this.processEvents();
      }

      // 2. 更新成员状态
      membersUpdated = this.updateMembers(deltaTime);

      // 3. 更新性能统计
      const processingTime = performance.now() - frameStartTime;
      this.recordFrameInfo(deltaTime, processingTime, eventsProcessed, membersUpdated);

      // 🔥 帧处理完成，直接发送状态更新（不需要判断是否有变化）
      if (this.onStateChange) {
        this.onStateChange({
          type: 'frame_update',
          data: {
            frameNumber: this.frameNumber,
            eventsProcessed,
            membersUpdated,
            processingTime,
            performanceStats: this.getPerformanceStats()
          }
        });
      }

    } catch (error) {
      console.error("❌ 帧处理错误:", error);
      // 可以选择停止帧循环或继续运行
    }
  }

  /**
   * 处理事件队列
   * 
   * @returns 处理的事件数量
   */
  private processEvents(): number {
    if (!this.eventQueue) {
      return 0;
    }

    const eventsToProcess = this.eventQueue.getEventsToProcess(this.frameNumber, this.config.maxEventsPerFrame);
    let processedCount = 0;

    for (const event of eventsToProcess) {
      const startTime = performance.now();
      
      try {
        // 同步处理事件，确保帧内完成
        const success = this.executeEventSync(event);
        
        const processingTime = performance.now() - startTime;
        this.eventQueue.markAsProcessed(event.id, processingTime);
        
        if (success) {
          processedCount++;
        }
      } catch (error) {
        console.error(`❌ 事件处理失败: ${event.id}`, error);
        this.eventQueue.markAsProcessed(event.id);
      }
    }

    // 清理已处理的事件
    if (processedCount > 0) {
      this.eventQueue.cleanup();
    }

    return processedCount;
  }

  /**
   * 同步执行单个事件
   * 
   * @param event 事件对象
   * @returns 执行是否成功
   */
  private executeEventSync(event: QueueEvent): boolean {
    // 查找对应的事件处理器
    const handler = this.eventHandlers.get(event.type);
    
    if (!handler) {
      console.warn(`⚠️ 未找到事件处理器: ${event.type}`);
      return false;
    }

    // 检查处理器是否能处理此事件
    if (!handler.canHandle(event)) {
      console.log(`⚠️ 事件处理器拒绝处理: ${event.type}`);
      return false;
    }

    // 创建执行上下文
    const context: ExecutionContext = {
      currentFrame: this.frameNumber,
      timeScale: this.timeScale,
      engineState: {
        frameNumber: this.frameNumber,
        memberRegistry: this.memberRegistry,
        eventQueue: this.eventQueue
      }
    };

    try {
      // 同步执行事件处理
      const result = this.executeHandlerSync(handler, event, context);

      if (result.success) {
        // 如果产生了新事件，插入到事件队列
        if (result.newEvents && result.newEvents.length > 0) {
          for (const newEvent of result.newEvents) {
            this.eventQueue?.insert(newEvent);
          }
        }
        
        console.log(`✅ 事件处理成功: ${event.type}`);
        return true;
      } else {
        console.warn(`⚠️ 事件处理失败: ${event.type} - ${result.error}`);
        return false;
      }

    } catch (error) {
      console.error(`❌ 事件处理异常: ${event.type}`, error);
      return false;
    }
  }

  /**
   * 同步执行事件处理器
   * 
   * @param handler 事件处理器
   * @param event 事件对象
   * @param context 执行上下文
   * @returns 执行结果
   */
  private executeHandlerSync(handler: EventHandler, event: BaseEvent, context: ExecutionContext): EventResult {
    // 如果处理器返回Promise，我们需要同步等待
    const result = handler.execute(event, context);
    
    if (result instanceof Promise) {
      // 在帧循环中，我们不能等待异步操作
      // 记录警告并返回失败
      console.warn(`⚠️ 事件处理器 ${event.type} 返回Promise，帧循环需要同步处理`);
      return {
        success: false,
        error: 'Async handler not supported in frame loop'
      };
    }
    
    return result;
  }

  /**
   * 更新成员状态
   * 
   * @param deltaTime 帧间隔时间
   * @returns 更新的成员数量
   */
  private updateMembers(deltaTime: number): number {
    const members = this.memberRegistry.getAllMembers();
    let updatedCount = 0;

    for (const member of members) {
      try {
        // 更新成员状态（例如：HP/MP恢复，Buff倒计时等）
        this.updateMemberState(member, deltaTime);
        updatedCount++;
      } catch (error) {
        console.error(`❌ 成员更新失败: ${member.getId()}`, error);
      }
    }

    return updatedCount;
  }

  /**
   * 更新单个成员状态
   * 
   * @param member 成员对象
   * @param deltaTime 帧间隔时间
   */
  private updateMemberState(member: any, deltaTime: number): void {
    // 调用成员的update方法
    if (typeof member.update === 'function') {
      member.update(deltaTime);
    }

    // 推进成员的状态机
    if (member.getFSM && typeof member.getFSM === 'function') {
      const fsm = member.getFSM();
      if (fsm) {
        // 发送时间推进事件到状态机
        try {
          fsm.send({
            type: 'FRAME_UPDATE',
            data: {
              deltaTime,
              currentFrame: this.frameNumber,
              timeScale: this.timeScale
            }
          });
        } catch (error) {
          console.log(`状态机更新失败: ${member.getId()}`, error);
        }
      }
    }

    // 处理Buff系统
    this.updateMemberBuffs(member, deltaTime);
  }

  /**
   * 更新成员的Buff状态
   * 
   * @param member 成员对象
   * @param deltaTime 帧间隔时间
   */
  private updateMemberBuffs(member: any, deltaTime: number): void {
    // TODO: 实现Buff系统更新逻辑
    // 这里应该：
    // 1. 遍历成员的所有Buff
    // 2. 更新Buff的持续时间
    // 3. 触发Buff效果
    // 4. 移除过期的Buff
    // 5. 生成相应的事件
  }

  /**
   * 记录帧信息
   * 
   * @param deltaTime 帧间隔时间
   * @param processingTime 处理时间
   * @param eventsProcessed 处理的事件数量
   * @param membersUpdated 更新的成员数量
   */
  private recordFrameInfo(deltaTime: number, processingTime: number, eventsProcessed: number, membersUpdated: number): void {
    const frameInfo: FrameInfo = {
      frameNumber: this.frameNumber,
      timestamp: performance.now(),
      deltaTime,
      processingTime,
      eventsProcessed,
      membersUpdated
    };

    this.frameHistory.push(frameInfo);

    // 限制历史记录数量
    if (this.frameHistory.length > 1000) {
      this.frameHistory = this.frameHistory.slice(-500);
    }

    // 更新性能统计
    if (this.config.enablePerformanceMonitoring) {
      this.updatePerformanceStats(frameInfo);
    }
  }

  /**
   * 更新性能统计
   * 
   * @param frameInfo 帧信息
   */
  private updatePerformanceStats(frameInfo?: FrameInfo): void {
    if (!this.config.enablePerformanceMonitoring) {
      return;
    }

    const currentTime = performance.now();
    const totalRunTime = currentTime - this.startTime;

    // 更新基本统计
    this.performanceStats.totalFrames = this.frameNumber;
    this.performanceStats.totalRunTime = totalRunTime;
    this.performanceStats.averageFPS = this.frameNumber / (totalRunTime / 1000);

    if (frameInfo) {
      // 更新帧时间历史
      this.performanceStats.frameTimeHistory.push(frameInfo.processingTime);
      if (this.performanceStats.frameTimeHistory.length > 100) {
        this.performanceStats.frameTimeHistory = this.performanceStats.frameTimeHistory.slice(-100);
      }

      // 更新帧率历史
      const fps = 1000 / frameInfo.deltaTime;
      this.performanceStats.fpsHistory.push(fps);
      if (this.performanceStats.fpsHistory.length > 100) {
        this.performanceStats.fpsHistory = this.performanceStats.fpsHistory.slice(-100);
      }

      // 计算平均帧处理时间
      const avgFrameTime = this.performanceStats.frameTimeHistory.reduce((sum, time) => sum + time, 0) / this.performanceStats.frameTimeHistory.length;
      this.performanceStats.averageFrameTime = avgFrameTime;

      // 更新事件统计
      this.performanceStats.eventStats.totalEventsProcessed += frameInfo.eventsProcessed;
      this.performanceStats.eventStats.averageEventsPerFrame = this.performanceStats.eventStats.totalEventsProcessed / this.frameNumber;
      this.performanceStats.eventStats.maxEventsPerFrame = Math.max(this.performanceStats.eventStats.maxEventsPerFrame, frameInfo.eventsProcessed);
    }
  }

  /**
   * 重置性能统计
   */
  private resetPerformanceStats(): void {
    this.performanceStats = {
      averageFPS: 0,
      averageFrameTime: 0,
      totalFrames: 0,
      totalRunTime: 0,
      fpsHistory: [],
      frameTimeHistory: [],
      eventStats: {
        totalEventsProcessed: 0,
        averageEventsPerFrame: 0,
        maxEventsPerFrame: 0
      }
    };
    this.frameHistory = [];
  }
}

// ============================== 导出 ==============================

export default FrameLoop;