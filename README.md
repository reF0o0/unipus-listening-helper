# U校园听力助手

用于 U校园《新视野大学英语（第三版）视听说教程 1（思政智慧版）》部分练习的 Tampermonkey 脚本。脚本在课件页面填写可识别的题目，提交由你操作。当前版本匹配特定班级的课件地址，其他班级可能需要适配。

## 安装和更新

1. 从 [Tampermonkey 官网](https://www.tampermonkey.net/) 安装浏览器扩展。
2. 在仓库下载 [Tampermonkey 导入包](./outputs/U校园听力助手-Tampermonkey导入.json)，使用文件页的下载按钮保存原始 JSON。
3. 打开 Tampermonkey 管理面板，进入「实用工具」，在文件导入区选择 JSON。更新时覆盖现有的同名脚本。
4. 打开 U校园课件的练习页。看到「U校园听力助手」面板后即可使用。

## 面板操作

| 按钮 | 行为 |
| --- | --- |
| 填写本页 | 从当前题页填写，部分题组会继续填写组内的下一题。 |
| 只填本单元 | 从当前题页向后填写本单元支持的练习。 |
| 全课只填写 | 从当前题页向后处理各单元支持的练习。 |
| 停止 | 结束当前运行，并取消已安排的自动恢复。 |

按住面板标题可以拖动，位置会保存在当前浏览器。展开「待处理」可查看未完成、待确认或待录音的题页。录音由你在课件中完成。

## 覆盖范围

- Unit 1–8 的 Sharing、Listening、Viewing 和 More practice in listening 中的部分练习。
- Unit 1 的部分 Role-playing、Presenting、Lead-in 和 World story 练习。其中 `1-10 World story → Viewing and understanding` 支持洞穴壁画视频的五道单选题。
- 面板的「已填写」表示脚本在当时的页面上读回了答案。是否已保存或提交，以重新打开课件后的状态为准。面板标出的「猜填」和「示例」需要自行核对。

## 文件和版本

- [脚本源码](./outputs/U校园听力助手.user.js)
- [历史版本标签](https://github.com/reF0o0/unipus-listening-helper/tags)
- [教材听力原文](https://news.culr.edu.cn/wyx/docs/2017-03/20170326101926785482.pdf)及[洞穴壁画纪录片字幕](https://subsaga.com/bbc/documentaries/factual/civilisations/series-1/1-second-moment-of-creation.html)
