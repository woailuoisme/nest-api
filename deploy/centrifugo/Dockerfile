FROM centrifugo/centrifugo:v5

# 拷贝 Centrifugo 配置文件并赋予对应运行用户权限
COPY --chown=centrifugo:centrifugo config.yaml /centrifugo/config.yaml

# 容器内嵌健康检查探针 (探测 HTTP /health 端点)
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8000/health || exit 1

# 暴露客户端与 API 端口
EXPOSE 8000

# 默认加载内嵌的 YAML 配置文件
CMD ["centrifugo", "-c", "/centrifugo/config.yaml"]
