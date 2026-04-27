---
title: "从0到1构建多传感器融合自动驾驶感知系统"
category: "autonomous-driving"
categoryName: "自动驾驶"
date: "2026-04-22"
tags: ["自动驾驶", "多传感器融合", "PyTorch", "深度学习", "感知系统"]
description: "本文手把手教你构建一个完整的多传感器融合感知系统，涵盖相机与激光雷达数据同步、点云处理、BEV视角转换与融合网络的实战代码。"
---

# 从0到1构建多传感器融合自动驾驶感知系统

多传感器融合（Multi-Sensor Fusion，MSF）是自动驾驶感知层的核心技术。通过融合摄像头（Camera）和激光雷达（LiDAR）的互补优势，系统能够同时获得丰富的语义信息和精确的空间位置数据，从而在复杂驾驶场景中实现可靠的环境感知。

本文将带你从零构建一个实用的多传感器融合感知系统，采用 PyTorch 深度学习框架，涵盖数据同步、点云处理、BEV（Bird's Eye View）视角转换与融合网络训练的全流程。

## 一、为什么需要多传感器融合

摄像头和激光雷达各有其不可替代的优势与明显短板：

| 传感器 | 优势 | 劣势 |
|-------|------|------|
| 相机 | 语义信息丰富（目标分类、颜色、纹理）；成本低 | 无深度信息；对光照、天气敏感 |
| 激光雷达 | 精确的3D空间坐标；不依赖光照 | 语义信息匮乏；稀疏性；成本高 |

单一传感器的感知系统在恶劣天气、夜间或复杂遮挡场景中极易失效。多传感器融合的核心思想是「取长补短」——用相机的语义理解能力弥补 LiDAR 的感知局限，用 LiDAR 的精确深度信息弥补相机的盲区。

## 二、系统架构概览

我们的多传感器融合感知系统分为以下模块：

```
原始数据 (Camera Image + LiDAR Point Cloud)
    ↓
数据同步与预处理 (Sync & Calibration)
    ↓
BEV 视角转换 (Bird's Eye View Transform)
    ↓
特征提取 (Encoder: Image Branch + Point Branch)
    ↓
多模态融合 (Fusion Network)
    ↓
3D 检测头 (Detection Head)
    ↓
输出: 3D Bounding Boxes + 类别 + 置信度
```

## 三、环境准备

首先安装必要的依赖：

```bash
pip install torch torchvision
pip install open3d==0.18.0   # 点云可视化与处理
pip install nuscenes-devkit   # NuScenes 数据集 SDK
pip install pyyaml
pip install matplotlib
```

本文使用 NuScenes 开源数据集作为示例数据。

## 四、数据同步与标定

### 4.1 传感器标定

多传感器融合的前提是精确的外参标定——即各传感器之间的空间位置关系。我们用 YAML 文件存储标定参数：

```yaml
# calibration.yaml
camera:
  fx: 1266.4
  fy: 1266.4
  cx: 640.0
  cy: 360.0
  width: 1280
  height: 720

lidar:
  x: 0.0      # LiDAR 相对车体中心的位置 (单位: 米)
  y: 0.0
  z: 1.5

extrinsic_camera_to_lidar:
  rotation: [0.0, -0.707, 0.0, 0.707]  # quaternion [qx, qy, qz, qw]
  translation: [0.0, 0.3, -0.2]
```

### 4.2 点云投影到图像

将 3D 点云投影到 2D 图像平面是多模态融合的常见操作：

```python
import numpy as np
import torch

def project_lidar_to_image(points, calib, img_width=1280, img_height=720):
    """
    将激光雷达点云投影到相机图像平面
    points: (N, 3) — x, y, z 坐标 (LiDAR 坐标系)
    calib: 标定参数
    返回: (N, 2) 图像坐标 + 有效掩码
    """
    # 1. 从 LiDAR 坐标系转到相机坐标系
    # 外参矩阵: [R|t]，将点从 LiDAR 坐标系变换到相机坐标系
    R = np.array(calib['extrinsic_camera_to_lidar']['rotation'])
    t = np.array(calib['extrinsic_camera_to_lidar']['translation'])

    # 四元数转旋转矩阵
    qx, qy, qz, qw = R
    R_mat = np.array([
        [1 - 2*(qy**2 + qz**2), 2*(qx*qy - qz*qw), 2*(qx*qz + qy*qw)],
        [2*(qx*qy + qz*qw), 1 - 2*(qx**2 + qz**2), 2*(qy*qz - qx*qw)],
        [2*(qx*qz - qy*qw), 2*(qy*qz + qx*qw), 1 - 2*(qx**2 + qy**2)]
    ])

    # 点从 LiDAR -> 相机坐标系 (需要转置再变换)
    points_cam = points @ R_mat.T + t

    # 过滤掉相机后方的点
    valid = points_cam[:, 2] > 0
    points_cam = points_cam[valid]

    # 2. 从相机坐标系投影到图像平面
    fx = calib['camera']['fx']
    fy = calib['camera']['fy']
    cx = calib['camera']['cx']
    cy = calib['camera']['cy']

    u = fx * points_cam[:, 0] / points_cam[:, 2] + cx
    v = fy * points_cam[:, 1] / points_cam[:, 2] + cy

    # 图像边界裁剪
    in_image = (u >= 0) & (u < img_width) & (v >= 0) & (v < img_height)
    coords = np.stack([u[in_image], v[in_image]], axis=1)

    valid_mask = np.zeros(len(points), dtype=bool)
    valid_mask[valid] = in_image

    return coords, valid_mask
```

## 五、BEV 视角转换

BEV（Bird's Eye View，鸟瞰图）是将 3D 空间投影到二维俯视图的标准做法，是当前 3D 感知的主流范式。

### 5.1 点云转 BEV

```python
def point_to_bev(points, x_range=(-50, 50), y_range=(-50, 50), z_range=(-3, 3), resolution=0.1):
    """
    将点云转换为 BEV 特征图
    points: (N, 3) 点云
    返回: (C, H, W) BEV 特征图
    """
    x_min, x_max = x_range
    y_min, y_max = y_range
    z_min, z_max = z_range

    # 过滤感兴趣区域内的点
    mask = (
        (points[:, 0] >= x_min) & (points[:, 0] < x_max) &
        (points[:, 1] >= y_min) & (points[:, 1] < y_max) &
        (points[:, 2] >= z_min) & (points[:, 2] < z_max)
    )
    points = points[mask]

    # 计算 BEV 网格坐标
    grid_x = ((points[:, 0] - x_min) / resolution).astype(np.int32)
    grid_y = ((points[:, 1] - y_min) / resolution).astype(np.int32)

    H = int((y_max - y_min) / resolution)
    W = int((x_max - x_min) / resolution)

    # 多通道 BEV: [height, intensity, density]
    bev = np.zeros((3, H, W), dtype=np.float32)

    # 高度通道：取每个格子内最高点的高度（归一化）
    for i in range(len(points)):
        bev[0, grid_y[i], grid_x[i]] = max(bev[0, grid_y[i], grid_x[i]], points[i, 2] / z_max)

    # 密度通道：统计每个格子的点数
    for i in range(len(points)):
        bev[2, grid_y[i], grid_x[i]] += 1

    # 点数归一化到 [0, 1]
    bev[2] = np.clip(bev[2] / 10.0, 0, 1)

    # 强度通道（反射强度，如果有的话）
    # bev[1] = ...

    return bev
```

### 5.2 图像到 BEV 的视角转换（Learning-based）

硬投影方法丢失了大量语义信息。更先进的方法使用神经网络学习图像到 BEV 的转换，代表性工作有 BEVFormer、Lift-Splat-Shoot（LSS）等。这里介绍 LSS 的核心思路：

```python
class LiftSplatShoot(torch.nn.Module):
    """
    Lift-Splat-Shoot: 将多视角相机特征 "lift" 到 3D 空间，
    再 "splat" 到 BEV 平面
    """
    def __init__(self, grid_conf, feature_dim=256):
        super().__init__()
        self.grid_conf = grid_conf
        self.frustum = self.create_frustum()
        self.depth_net = torch.nn.Sequential(
            torch.nn.Conv2d(512, 256, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(256, 256, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(256, 1 + 256, 1),  # 1 for depth, 256 for features
        )
        self.bev_encoder = torch.nn.Sequential(
            torch.nn.Conv2d(256, 128, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(128, 256, 3, padding=1),
            torch.nn.ReLU(),
        )

    def create_frustum(self):
        """创建视锥，用于将图像特征 lift 到 3D 空间"""
        H, W = self.grid_conf['H'], self.grid_conf['W']
        dx = torch.arange(self.grid_conf['d_x'][0], self.grid_conf['d_x'][1], step=self.grid_conf['d_x'][2])
        dims = {'x': self.grid_conf['x'], 'y': self.grid_conf['y'], 'z': self.grid_conf['z']}
        # 构建 3D frustum 坐标 [D, H, W, 3]
        frustum = torch.zeros(D, H, W, 3)
        # ... (省略细节: 根据相机内参和外参计算每个像素的 3D 射线方向)
        return frustum

    def forward(self, x):
        """
        x: (B, C, H, W) 图像特征
        返回: (B, 256, H_bev, W_bev) BEV 特征
        """
        # 预测每个像素的深度分布和上下文特征
        depth_logits = self.depth_net(x)  # (B, 1+256, H, W)
        depth_prob = torch.softmax(depth_logits[:, 0:1], dim=1)  # 深度概率分布
        context = depth_logits[:, 1:]  # (B, 256, H, W)

        # Lift: 将图像特征加权到 3D 空间
        # 根据深度概率分布重新加权重排图像特征到视锥体
        volume = context.unsqueeze(2) * depth_prob.unsqueeze(1)  # (B, C, D, H, W)

        # Splat: 将 3D volume 池化到 BEV 平面
        bev_feat = self.pool_to_bev(volume)  # (B, 256, H_bev, W_bev)

        # 编码 BEV 特征
        bev_feat = self.bev_encoder(bev_feat)
        return bev_feat

    def pool_to_bev(self, volume):
        """沿深度轴求和池化到 BEV"""
        # volume: (B, C, D, H, W) -> (B, C, H*W, D) -> sum over D -> (B, C, H*W)
        B, C, D, H, W = volume.shape
        volume = volume.permute(0, 1, 3, 4, 2)  # (B, C, H, W, D)
        bev = volume.flatten(3).sum(dim=-1)  # (B, C, H*W)
        bev = bev.view(B, C, H, W)
        return bev
```

## 六、融合网络与 3D 检测头

### 6.1 多模态融合

将 BEV 视角下的相机特征与点云特征进行融合：

```python
class MultiModalFusion(torch.nn.Module):
    def __init__(self, bev_channels=256, img_channels=256, fused_channels=512):
        super().__init__()
        # 图像 BEV 分支
        self.img_encoder = torch.nn.Sequential(
            torch.nn.Conv2d(img_channels, 256, 3, padding=1),
            torch.nn.BatchNorm2d(256),
            torch.nn.ReLU(),
            torch.nn.Conv2d(256, bev_channels, 3, padding=1),
        )
        # 点云 BEV 分支
        self.lidar_encoder = torch.nn.Sequential(
            torch.nn.Conv2d(3, 64, 3, padding=1),   # 输入: 3通道 BEV (height, intensity, density)
            torch.nn.BatchNorm2d(64),
            torch.nn.ReLU(),
            torch.nn.Conv2d(64, 128, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(128, bev_channels, 3, padding=1),
        )
        # 融合层
        self.fusion_conv = torch.nn.Sequential(
            torch.nn.Conv2d(bev_channels * 2, fused_channels, 3, padding=1),
            torch.nn.BatchNorm2d(fused_channels),
            torch.nn.ReLU(),
            torch.nn.Conv2d(fused_channels, bev_channels, 1),
        )

    def forward(self, img_bev, lidar_bev):
        """
        img_bev: (B, 256, H, W) 来自相机分支的 BEV 特征
        lidar_bev: (B, 3, H, W) 来自点云的 BEV 特征
        返回: (B, 256, H, W) 融合后的 BEV 特征
        """
        img_feat = self.img_encoder(img_bev)
        lidar_feat = self.lidar_encoder(lidar_bev)
        fused = torch.cat([img_feat, lidar_feat], dim=1)
        fused = self.fusion_conv(fused)
        return fused
```

### 6.2 3D 检测头

采用 anchor-based 检测头，输出类别、框回归参数和置信度：

```python
class DetectionHead(torch.nn.Module):
    def __init__(self, in_channels=256, num_classes=10, num_anchors=2):
        super().__init__()
        # 类别预测
        self.cls_head = torch.nn.Sequential(
            torch.nn.Conv2d(in_channels, 256, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(256, num_classes * num_anchors, 1),
        )
        # 3D 回归: (x, y, z, w, l, h, yaw)
        self.reg_head = torch.nn.Sequential(
            torch.nn.Conv2d(in_channels, 256, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(256, 7 * num_anchors, 1),
        )
        # 方向分类（处理 180° 歧义）
        self.dir_head = torch.nn.Sequential(
            torch.nn.Conv2d(in_channels, 256, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(256, 2 * num_anchors, 1),
        )

    def forward(self, x):
        """
        x: (B, 256, H, W) 融合后的 BEV 特征
        返回: cls (B, C, H, W), reg (B, 7, H, W), dir_cls (B, 2, H, W)
        """
        cls = self.cls_head(x)
        reg = self.reg_head(x)
        dir_cls = self.dir_head(x)
        return cls, reg, dir_cls
```

## 七、完整前向传播

将各模块组装为完整的感知系统：

```python
class PerceptionSystem(torch.nn.Module):
    def __init__(self, grid_conf, num_classes=10):
        super().__init__()
        self.camera_branch = LiftSplatShoot(grid_conf)
        self.lidar_branch = self._build_lidar_encoder()
        self.fusion = MultiModalFusion()
        self.detection_head = DetectionHead(num_classes=num_classes)

    def _build_lidar_encoder(self):
        return torch.nn.Sequential(
            torch.nn.Conv2d(3, 64, 3, padding=1),
            torch.nn.BatchNorm2d(64),
            torch.nn.ReLU(),
            torch.nn.MaxPool2d(2),
            torch.nn.Conv2d(64, 128, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.MaxPool2d(2),
            torch.nn.Conv2d(128, 256, 3, padding=1),
            torch.nn.ReLU(),
        )

    def forward(self, img, lidar_bev):
        """
        img: (B, 3, H, W) 相机图像
        lidar_bev: (B, 3, H, W) 点云 BEV 图
        返回: 3D 检测结果
        """
        img_bev = self.camera_branch(img)
        lidar_feat = self.lidar_branch(lidar_bev)
        fused = self.fusion(img_bev, lidar_feat)
        cls, reg, dir_cls = self.detection_head(fused)
        return cls, reg, dir_cls
```

## 八、训练与损失函数

```python
def compute_loss(cls_pred, reg_pred, dir_pred, targets, device):
    """
    cls_pred: (B, num_classes, H, W)
    reg_pred: (B, 7, H, W)
    dir_pred: (B, 2, H, W)
    targets: 包含 gt_boxes, gt_labels, gt_dirs 的字典
    """
    # 分类损失 (Focal Loss 处理类别不平衡)
    cls_loss = torch.nn.functional.binary_cross_entropy_with_logits(
        cls_pred.flatten(), 
        targets['cls_mask'].float().to(device).flatten()
    )

    # 回归损失 (Smooth L1)
    reg_loss = torch.nn.functional.smooth_l1_loss(
        reg_pred * targets['reg_mask'].to(device),
        targets['reg_target'].to(device)
    )

    # 方向损失
    dir_loss = torch.nn.functional.cross_entropy(
        dir_pred.permute(0, 2, 3, 1).reshape(-1, 2),
        targets['dir_target'].long().to(device).flatten()
    )

    total_loss = cls_loss + reg_loss + 0.2 * dir_loss
    return total_loss, cls_loss, reg_loss, dir_loss
```

## 九、结语

本文从实战角度构建了一个完整的多传感器融合感知系统，覆盖了从原始数据处理到 3D 检测输出的全流程。核心要点总结如下：

1. **标定是基础**：精确的外参标定是多模态融合的前提，标定误差会直接导致点云投影错位
2. **BEV 是主战场**：将不同传感器统一到 BEV 空间进行融合，是当前 3D 感知的主流范式
3. **融合策略决定上限**：早期融合（raw data）、特征融合（feature-level）、决策融合（prediction-level）各有优劣，特征级融合是最常见的选择
4. **深度学习驱动**：LSS 等 learning-based BEV 转换方法大幅提升了语义保留能力

在实际工业部署中，还需要考虑模型轻量化（TensorRT、ONNX）、实时推理（BEVFormer 等 transformer 架构）、长距离感知等技术挑战，这些将在后续文章中深入探讨。

---

*参考数据集：NuScenes（https://www.nuscenes.org/）*
*参考框架：OpenMMLab mmdetection3d, Lyft Perception*
