---
title: "NVIDIA Cosmos 3 具身智能实战：从安装到机器人动作预测"
category: "physical-ai"
categoryName: "具身智能"
date: "2026-06-06"
tags: ["NVIDIA Cosmos", "具身智能", "机器人", "World Model", "动作预测"]
description: "Cosmos 3 是全球首个开源的具身智能全能基础模型，整合物理推理、世界生成和动作预测三大能力。本文详解如何快速部署、推理和微调 Cosmos 3，构建机器人动作预测系统。"
---

2026年6月，NVIDIA在GTC大会上正式发布**Cosmos 3**，这是全球首个将物理推理（Physical Reasoning）、世界生成（World Generation）和动作预测（Action Prediction）三大能力整合在单一开源模型中的具身智能（Physical AI）基础模型。它的问世标志着机器人开发从"手写控制逻辑"向"数据驱动预测"的关键转折。本文手把手教你从零开始，在本地环境部署并运行Cosmos 3。

## 一、什么是Cosmos 3？

Cosmos 3 是NVIDIA推出的物理AI前沿基础模型系列，具备三大核心能力：

- **物理推理（Physical Reasoning）**：理解物理世界的因果关系，如重力、碰撞、摩擦等
- **世界生成（World Generation）**：根据当前状态生成未来的视频帧，即"世界模型"
- **动作预测（Action Prediction）**：给定机器人当前帧和动作序列，预测未来的动作结果

Cosmos 3 提供多个规模的版本：

| 模型版本 | 参数量 | 适用场景 |
|---------|-------|---------|
| Cosmos 3 Nano | 7B | 边缘设备、笔记本推理 |
| Cosmos 3 Super | 72B | 数据中心、高性能任务 |

支持的模态包括：视频输入、文本指令、机器人关节动作（Joint Actions）、末端执行器动作（End Effector Actions）等。

## 二、环境准备

### 硬件要求

- **最低**：16GB显存的GPU（如RTX 4080）
- **推荐**：80GB+ HBM的GPU（如A100或H100）用于训练

### 安装依赖

```bash
# 克隆官方仓库
git clone https://github.com/nvidia/Cosmos.git
cd Cosmos

# 创建conda环境
conda create -n cosmos3 python=3.10 -y
conda activate cosmos3

# 安装PyTorch（CUDA 12.4+）
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# 安装Cosmos核心依赖
pip install -e .

# 可选：安装NIM部署支持
pip install nim-cosmos
```

## 三、快速推理：从文本生成世界视频

Cosmos 3 支持通过简单的Python脚本生成符合物理规律的视频序列。以下是使用HuggingFace提供的预训练模型进行推理的完整示例：

```python
from cosmos_workflows.inference import WorldGenPipeline
import torch

# 加载预训练模型（自动从HuggingFace下载）
pipeline = WorldGenPipeline(
    model_id="nvidia/cosmos-3-super",
    device="cuda" if torch.cuda.is_available() else "cpu",
    torch_dtype=torch.bfloat16,
)

# 文本描述 + 初始帧 → 生成未来视频
result = pipeline.generate(
    prompt="A robotic arm picking up a red ball from a table",
    num_frames=32,
    guidance_scale=7.5,
    num_inference_steps=50,
)

# 保存生成的视频
result.save("output/world_video.mp4")
```

运行效果：给定"一个机械臂从桌上拿起红色球"的文本描述，Cosmos 3会生成一段符合物理规律的视频，预测机械臂执行该动作的过程。

## 四、动作预测：让机器人"预见"未来

Cosmos 3 的核心能力之一是**动作预测**（Action Prediction）——给定机器人当前状态的视频帧和动作序列，预测未来的世界状态。这被称为"前向动力学模型"（Forward Dynamics Model）。

### 4.1 数据准备（LeRobot格式）

Cosmos 3 的后训练（Post-training）使用LeRobot格式的数据集。如果你有自己的机器人数据，需要先转换为LeRobot格式：

```python
from lerobot.datasets import LeRobotDataset

# 示例：将自定义机器人数据转换为LeRobot格式
# 数据需包含：observation.images（摄像头图像）和 action（关节角度）

dataset = LeRobotDataset.from_raw_data(
    root="./my_robot_data",
    cameras=["wrist_camera", "overhead_camera"],
    robots=["panda_arm"],  # 对应你的机器人型号
    fps=30,
)
dataset.save("./lerobot_format/my_robot")
```

### 4.2 后训练配置

Cosmos 3 提供三种动作生成模式：

- **前向动力学（Forward Dynamics）**：输入当前帧 + 动作序列 → 预测未来状态
- **逆向动力学（Inverse Dynamics）**：输入当前帧 + 目标状态 → 预测所需动作
- **策略模式（Policy Mode）**：输入当前帧 + 任务描述 → 输出动作序列

以最常用的前向动力学为例，训练配置文件位于 `cosmos/docs/training.md`。核心配置如下：

```python
# action_joint_sft_nano_yam.py（简化的nano模型配置）
config = {
    "model": "cosmos-3-nano",
    "dataset": "lerobot_format/my_robot",
    "batch_size": 8,
    "gradient_accumulation_steps": 4,
    "learning_rate": 1e-4,
    "num_epochs": 10,
    "output_dir": "./checkpoints/cosmos3-fwd-dynamics",
    "mode": "forward_dynamics",
    "action_format": "joint",  # 关节角度格式
    "num_action_horizon": 16,  # 预测16帧的动作序列
}
```

### 4.3 开始后训练

```bash
# 使用8卡H100节点进行后训练
torchrun --nproc_per_node=8 \
    cosmos/scripts/train.py \
    --config cosmos/configs/action_joint_sft_nano_yam.py \
    --num_nodes 1
```

训练完成后，导出EMA权重用于推理：

```bash
python cosmos/scripts/export_checkpoints.py \
    --checkpoint ./checkpoints/cosmos3-fwd-dynamics/step_1000.pt \
    --output ./checkpoints/cosmos3-fwd-dynamics-ema
```

### 4.4 运行动作预测推理

```python
from cosmos_workflows.inference import ActionPredictionPipeline
import torch
import json

# 加载后训练好的模型
pipeline = ActionPredictionPipeline(
    checkpoint="./checkpoints/cosmos3-fwd-dynamics-ema",
    device="cuda",
    mode="forward_dynamics",
)

# 读取测试数据（Bridge数据格式）
with open("cosmos/examples/bridge_input.json", "r") as f:
    test_input = json.load(f)

# 执行动作预测
prediction = pipeline.predict(
    conditioning_frame=test_input["image"],  # 当前帧
    action_sequence=test_input["actions"],   # 动作序列
    task_description=test_input["task"],     # 任务描述
    num_future_frames=32,
)

# 保存预测结果：predicted_vs_ground_truth 对比视频
prediction.save_comparison(
    ground_truth="output/gt_video.mp4",
    prediction="output/pred_video.mp4"
)
```

## 五、使用NVIDIA NIM快速部署

如果不想自行管理模型，NVIDIA NIM提供了Cosmos 3的微服务化部署方案：

```bash
# 通过NGC获取NIM容器镜像
docker pull nvcr.io/nvidia/nim-cosmos:3.0

# 启动推理服务
docker run -d --gpus all \
    -p 8000:8000 \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    nvcr.io/nvidia/nim-cosmos:3.0

# 通过API调用
curl -X POST http://localhost:8000/v1/predict \
    -H "Content-Type: application/json" \
    -d '{
        "prompt": "A robot arm stacking blocks",
        "num_frames": 16
    }' \
    --output prediction.mp4
```

NIM版本支持自动批处理、动态GPU分配，适合生产环境。

## 六、实用技巧与避坑指南

**显存不足怎么办？**

使用量化版本的模型，或切换到Cosmos 3 Nano版本。Nano版仅需约16GB显存即可运行基本推理。

**动作预测效果不佳？**

检查数据质量——Cosmos 3 的后训练高度依赖数据质量。使用真实机器人采集的高质量演示数据，远优于仿真合成数据。

**推理速度太慢？**

启用KV Cache和动态批处理。NVIDIA的博客数据显示，通过这些优化，推理速度可提升3-5倍。

**如何评估模型效果？**

使用Cosmos Human Evaluation Benchmark（Cosmos-HEB）标准评测集，该基准覆盖了物体操控、导航、灵巧操作等常见具身智能任务。

## 结语

Cosmos 3 的发布意味着，具身智能的门槛正在大幅降低——开发者不再需要从零训练世界模型，直接在Cosmos 3的基础上微调即可。从工厂机器人到自动驾驶，物理AI的黄金时代正在到来。

如果你想深入了解，可以访问 [NVIDIA Cosmos官方页面](https://www.nvidia.com/en-us/ai/cosmos/) 和 [GitHub仓库](https://github.com/nvidia/Cosmos)，那里有最完整的技术文档和社区支持。