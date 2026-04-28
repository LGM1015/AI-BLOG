---
title: "具身智能开发实战：基于Python的人形机器人感知-决策-控制全链路"
category: "embodied-ai"
categoryName: "具身智能"
date: "2026-04-28"
tags: ["具身智能", "人形机器人", "感知决策控制", "Python", "VLA模型"]
description: "从零构建人形机器人的感知-决策-控制系统，使用VLA模型实现视觉语言动作闭环，附完整代码框架。"
---

2026年被业界普遍视为"具身智能商业化元年"。随着宇树科技、智元机器人等头部企业推进量产，人形机器人正从实验室走向工厂、医院、家庭。本教程介绍具身智能系统的核心架构，并用Python实现一个简化版的感知-决策-控制全链路 demo，帮助读者快速入门具身智能开发。

## 具身智能的核心闭环

具身智能（Embodied AI）与传统AI的本质区别在于"身体"——系统不仅处理抽象信息，还要在物理世界中执行动作。其核心技术闭环为：

```
感知（Sense）→ 理解（Think）→ 决策（Plan）→ 执行（Act）→ 反馈（Feedback）
```

- **感知**：摄像头、深度相机、IMU、力传感器等获取环境状态
- **理解**：VLM（视觉语言模型）理解场景语义
- **决策**：VLA（视觉语言动作）模型将理解转化为具体动作指令
- **执行**：控制器驱动电机执行动作
- **反馈**：传感器数据回传，更新环境模型

## 环境准备

```bash
pip install numpy opencv-python torch transformers
pip install rclpy                      # ROS2 Python接口（机器人操作系统）
pip install python-socketio scipy
```

本教程使用开源VLA模型`LLMFT/VLA-7B`作为决策核心，你也可以替换为国产的MiniMax或Qwen-VLA系列。

## 第一步：传感器数据采集（感知层）

```python
import cv2
import numpy as np
from dataclasses import dataclass
from typing import List, Tuple

@dataclass
class RobotObservation:
    """机器人感知数据结构"""
    rgb_image: np.ndarray           # RGB视觉
    depth_image: np.ndarray         # 深度图
    joint_positions: np.ndarray     # 关节角度
    joint_velocities: np.ndarray    # 关节速度
    end_effector_pose: np.ndarray    # 末端执行器位置姿态
    external_force: np.ndarray       # 外部力反馈
    timestamp: float

class SensorInterface:
    """统一传感器接口，兼容ROS2或独立运行"""
    
    def __init__(self, use_ros: bool = False):
        self.use_ros = use_ros
        self.rgb_topic = "/camera/rgb"
        self.depth_topic = "/camera/depth"
        self.joint_topic = "/robot/joint_states"
        
        # 模拟传感器（无ROS环境下使用）
        self._frame_count = 0
    
    def read(self) -> RobotObservation:
        if self.use_ros:
            return self._read_from_ros()
        return self._read_simulated()
    
    def _read_simulated(self) -> RobotObservation:
        """模拟传感器数据，用于算法开发和测试"""
        self._frame_count += 1
        
        # 模拟640x480 RGB图像
        rgb = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
        
        # 模拟深度图（米为单位，0.1-10米范围）
        depth = np.random.uniform(0.5, 5.0, (480, 640)).astype(np.float32)
        
        # 模拟17自由度人形机器人关节状态
        joint_positions = np.random.uniform(-np.pi, np.pi, 17)
        joint_velocities = np.random.uniform(-1, 1, 17)
        
        # 末端执行器（右手）位置和姿态
        end_effector_pose = np.array([0.5, -0.3, 0.8, 0, 0, 0])  # x,y,z + roll,pitch,yaw
        
        # 力传感器（3轴力/力矩）
        external_force = np.random.uniform(-50, 50, 6)
        
        import time
        return RobotObservation(
            rgb_image=rgb,
            depth_image=depth,
            joint_positions=joint_positions,
            joint_velocities=joint_velocities,
            end_effector_pose=end_effector_pose,
            external_force=external_force,
            timestamp=time.time()
        )
```

## 第二步：场景理解（VLM层）

```python
from transformers import AutoProcessor, AutoModelForVision2Seq
import torch

class SceneUnderstanding:
    """使用VLM理解机器人当前视觉场景"""
    
    def __init__(self, model_name: str = "THUDM/VLA-7B"):
        self.processor = AutoProcessor.from_pretrained(model_name)
        self.model = AutoModelForVision2Seq.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        self.model.eval()
    
    def describe_scene(self, rgb_image: np.ndarray) -> str:
        """输入图像，输出自然语言场景描述"""
        messages = [
            {"role": "user", "content": [
                {"type": "image"},
                {"type": "text", "text": "请描述这张图像中机器人的周围环境，包括：物体种类、位置关系、可能的空间障碍。"}
            ]}
        ]
        
        inputs = self.processor(text=messages, images=rgb_image, return_tensors="pt")
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = self.model.generate(**inputs, max_new_tokens=256)
        
        description = self.processor.batch_decode(outputs, skip_special_tokens=True)[0]
        return description
    
    def detect_grasp_points(self, rgb_image: np.ndarray, target_object: str) -> List[Tuple[int, int]]:
        """检测可抓取物体位置，返回像素坐标列表"""
        messages = [
            {"role": "user", "content": [
                {"type": "image"},
                {"type": "text", "text": f"请标出图像中所有'{target_object}'的边界框中心点坐标（x,y像素值）。如果没有找到，回答'未找到'。"}
            ]}
        ]
        
        inputs = self.processor(text=messages, images=rgb_image, return_tensors="pt")
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = self.model.generate(**inputs, max_new_tokens=128)
        
        result = self.processor.batch_decode(outputs, skip_special_tokens=True)[0]
        
        # 解析坐标（简化版，实际需要更robust的解析）
        points = []
        if "未找到" not in result:
            import re
            coords = re.findall(r'\((\d+),\s*(\d+)\)', result)
            for x, y in coords:
                points.append((int(x), int(y)))
        
        return points
```

## 第三步：任务规划与动作生成（VLA层）

```python
class VLAActionPlanner:
    """VLA模型：将自然语言任务和视觉感知转化为精确动作序列"""
    
    def __init__(self, model_name: str = "LLMFT/VLA-7B"):
        self.processor = AutoProcessor.from_pretrained(model_name)
        self.model = AutoModelForVision2Seq.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        self.model.eval()
        
        # 动作空间定义（17个关节 + 末端执行器）
        self.action_dim = 17 + 6  # 17关节角度 + 末端位姿增量
    
    def plan_action(
        self,
        task: str,
        rgb_image: np.ndarray,
        joint_positions: np.ndarray,
        scene_description: str
    ) -> np.ndarray:
        """
        输入任务和当前状态，输出动作向量
        返回: shape=(action_dim,) 的动作指令
        """
        messages = [
            {"role": "user", "content": [
                {"type": "image"},
                {"type": "text", "text": f"""你是一个人形机器人控制器。当前状态如下：
- 任务：{task}
- 场景描述：{scene_description}
- 当前关节角度（弧度，共17个）：{joint_positions.round(3).tolist()}

请输出接下来0.5秒的机器人动作，格式为17个关节角度目标值（范围-3.14到3.14）和末端执行器位姿增量（x,y,z偏移和roll,pitch,yaw偏移）。

只输出数字，用逗号分隔，共23个数字，不要输出任何解释。"""}
            ]}
        ]
        
        inputs = self.processor(text=messages, images=rgb_image, return_tensors="pt")
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = self.model.generate(**inputs, max_new_tokens=128)
        
        action_text = self.processor.batch_decode(outputs, skip_special_tokens=True)[0]
        
        # 解析动作向量
        action = self._parse_action(action_text)
        return action
    
    def _parse_action(self, text: str) -> np.ndarray:
        """从文本中解析出动作向量"""
        import re
        numbers = re.findall(r'-?\d+\.?\d*', text)
        
        if len(numbers) >= 23:
            return np.array([float(n) for n in numbers[:23]], dtype=np.float32)
        else:
            # 默认保持当前状态
            return np.zeros(23, dtype=np.float32)
```

## 第四步：运动控制与执行

```python
from scipy.spatial.transform import Rotation

class MotionController:
    """将VLA输出的动作向量转换为关节控制信号"""
    
    def __init__(self, robot_ip: str = None):
        self.Kp = np.diag([50.0] * 17)   # 关节位置增益
        self.Kd = np.array([5.0] * 17)   # 阻尼系数
        self.max_velocity = np.pi / 3    # 关节最大速度（rad/s）
    
    def compute_torque(
        self,
        target_joint_positions: np.ndarray,
        current_joint_positions: np.ndarray,
        current_joint_velocities: np.ndarray
    ) -> np.ndarray:
        """计算PD控制力矩"""
        position_error = target_joint_positions - current_joint_positions
        
        # 限制最大速度
        velocity_limit = self.max_velocity
        position_error = np.clip(position_error, -velocity_limit, velocity_limit)
        
        # PD控制
        torque = self.Kp @ position_error - self.Kd * current_joint_velocities
        
        # 安全限制：力矩上限
        max_torque = 150.0  # Nm
        torque = np.clip(torque, -max_torque, max_torque)
        
        return torque
    
    def send_to_robot(self, torque: np.ndarray, robot_ip: str = None):
        """通过Socket或ROS发送力矩指令到机器人"""
        if robot_ip:
            # 实际机器人通信协议
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect((robot_ip, 5000))
            sock.send(torque.astype(np.float32).tobytes())
            sock.close()
        else:
            # 仿真模式：直接打印
            print(f"[控制指令] 力矩: {torque.round(1).tolist()}")

    def compute_inverse_kinematics(
        self,
        target_pose: np.ndarray,
        current_joint_positions: np.ndarray
    ) -> np.ndarray:
        """
        数值法逆运动学：将末端目标位姿转换为关节角度
        target_pose: [x, y, z, roll, pitch, yaw]
        """
        from scipy.optimize import minimize
        
        def joint_error(q):
            fk = self._forward_kinematics(q)
            return np.sum((fk - target_pose) ** 2)
        
        result = minimize(
            joint_error,
            current_joint_positions,
            method='L-BFGS-B',
            bounds=[(-np.pi, np.pi)] * 17
        )
        
        return result.x if result.success else current_joint_positions
    
    def _forward_kinematics(self, joint_positions: np.ndarray) -> np.ndarray:
        """简化版正运动学（实际需用URDF或Mujoco模型）"""
        # 这里返回当前末端执行器位置的估算
        return np.array([0.5, -0.3, 0.8, 0, 0, 0])
```

## 第五步：主控制循环

```python
class EmbodiedControlLoop:
    """具身智能主控制循环"""
    
    def __init__(self):
        self.sensors = SensorInterface(use_ros=False)
        self.scene_understander = SceneUnderstanding()
        self.vla_planner = VLAActionPlanner()
        self.controller = MotionController()
        
        self.running = False
    
    def execute_task(self, task: str, max_steps: int = 100):
        """执行自然语言描述的任务"""
        print(f"[任务启动] {task}")
        self.running = True
        
        for step in range(max_steps):
            if not self.running:
                break
            
            # 1. 感知
            obs = self.sensors.read()
            
            # 2. 场景理解
            scene_desc = self.scene_understander.describe_scene(obs.rgb_image)
            
            if step % 10 == 0:  # 每10步打印一次场景理解
                print(f"[步骤{step}] 场景: {scene_desc[:100]}...")
            
            # 3. VLA动作规划
            action = self.vla_planner.plan_action(
                task=task,
                rgb_image=obs.rgb_image,
                joint_positions=obs.joint_positions,
                scene_description=scene_desc
            )
            
            # 分离关节目标和末端执行器目标
            target_joints = action[:17]
            target_ee_delta = action[17:]
            
            # 4. 运动控制
            torque = self.controller.compute_torque(
                target_joint_positions=target_joints,
                current_joint_positions=obs.joint_positions,
                current_joint_velocities=obs.joint_velocities
            )
            
            self.controller.send_to_robot(torque)
            
            # 5. 安全检查
            if self._safety_check(obs):
                print("[安全] 检测到碰撞或异常，停止任务")
                self.running = False
                break
        
        print("[任务完成]")
    
    def _safety_check(self, obs: RobotObservation) -> bool:
        """安全检查：关节限位、力矩限制、碰撞检测"""
        # 关节软限位
        if np.any(np.abs(obs.joint_positions) > np.pi * 0.95):
            return True
        
        # 外部力异常
        if np.any(np.abs(obs.external_force[:3]) > 200):  # 力阈值
            return True
        
        return False

    def stop(self):
        self.running = False

# 运行示例
if __name__ == "__main__":
    controller = EmbodiedControlLoop()
    controller.execute_task(
        task="请将桌上红色方块拿起放到左侧蓝色盒子里",
        max_steps=200
    )
```

## 行业工具链推荐

上述demo展示了具身智能的核心逻辑，但实际开发远比这复杂。以下是当前行业主流工具链：

- **仿真平台**：NVIDIA Isaac Sim（高保真物理仿真）、MuJoCo（开源，刚性好）、Webots（轻量级）
- **训练数据**：百度具身智能数据超市（行业首个层级化数据标签体系）、ManiSkill（开源操作数据集）
- **VLA模型**：Google RT系列、OpenVLA、国产的宇树UniAI、智元AnyWorker
- **硬件中间件**：ROS2（最通用）、华为海思MRK协议（国产机器人）

具身智能的门槛正在快速下降，但真正的难点在于泛化——让机器人在一个场景学会的技能，迁移到另一个从未见过的场景。这需要更大的数据、更强的模型，也是接下来几年最具突破价值的研发方向。
