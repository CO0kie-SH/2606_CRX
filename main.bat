@chcp 65001>nul
@title 浏览器插件
@cd /d %~dp0
@set PYTHONIOENCODING=utf-8

@set path=D:\0Code2\py312;D:\0Code2\Py310avatr\Scripts;%path%
@set path=D:\job\py312\Scripts;D:\job\py312;%path%

set fei_title="浏览器插件"
::set only_work=Workday

python main.py --host 0.0.0.0 --port 8080 %*
