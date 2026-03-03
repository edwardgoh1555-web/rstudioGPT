# R/StudioGPT Splash Screen - Truly Borderless WPF Window
Add-Type -AssemblyName PresentationFramework

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="R/StudioGPT" 
        Width="400" Height="450"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        WindowStartupLocation="CenterScreen"
        Topmost="True"
        ShowInTaskbar="False">
    <Border CornerRadius="12" Background="#0f0f23">
        <Grid>
            <!-- Glow orbs -->
            <Ellipse Width="150" Height="150" HorizontalAlignment="Left" VerticalAlignment="Top" Margin="20,40,0,0" Opacity="0.2">
                <Ellipse.Fill>
                    <RadialGradientBrush>
                        <GradientStop Color="#8b5cf6" Offset="0"/>
                        <GradientStop Color="Transparent" Offset="1"/>
                    </RadialGradientBrush>
                </Ellipse.Fill>
            </Ellipse>
            <Ellipse Width="120" Height="120" HorizontalAlignment="Right" VerticalAlignment="Bottom" Margin="0,0,30,70" Opacity="0.2">
                <Ellipse.Fill>
                    <RadialGradientBrush>
                        <GradientStop Color="#6366f1" Offset="0"/>
                        <GradientStop Color="Transparent" Offset="1"/>
                    </RadialGradientBrush>
                </Ellipse.Fill>
            </Ellipse>
            
            <!-- Main content -->
            <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center">
                <!-- Logo with spinning rings -->
                <Grid Width="120" Height="120" Margin="0,0,0,30">
                    <!-- Outer ring -->
                    <Ellipse Stroke="#6366f1" StrokeThickness="3" RenderTransformOrigin="0.5,0.5" x:Name="ring1">
                        <Ellipse.RenderTransform>
                            <RotateTransform/>
                        </Ellipse.RenderTransform>
                        <Ellipse.StrokeDashArray>
                            <DoubleCollection>3,3</DoubleCollection>
                        </Ellipse.StrokeDashArray>
                    </Ellipse>
                    <!-- Middle ring -->
                    <Ellipse Stroke="#8b5cf6" StrokeThickness="3" Margin="10" RenderTransformOrigin="0.5,0.5" x:Name="ring2">
                        <Ellipse.RenderTransform>
                            <RotateTransform/>
                        </Ellipse.RenderTransform>
                        <Ellipse.StrokeDashArray>
                            <DoubleCollection>2,4</DoubleCollection>
                        </Ellipse.StrokeDashArray>
                    </Ellipse>
                    <!-- Inner ring -->
                    <Ellipse Stroke="#a78bfa" StrokeThickness="3" Margin="20" RenderTransformOrigin="0.5,0.5" x:Name="ring3">
                        <Ellipse.RenderTransform>
                            <RotateTransform/>
                        </Ellipse.RenderTransform>
                        <Ellipse.StrokeDashArray>
                            <DoubleCollection>1,5</DoubleCollection>
                        </Ellipse.StrokeDashArray>
                    </Ellipse>
                    <!-- Center circle with logo -->
                    <Ellipse Margin="30">
                        <Ellipse.Fill>
                            <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                                <GradientStop Color="#6366f1" Offset="0"/>
                                <GradientStop Color="#8b5cf6" Offset="1"/>
                            </LinearGradientBrush>
                        </Ellipse.Fill>
                        <Ellipse.Effect>
                            <DropShadowEffect Color="#6366f1" BlurRadius="40" ShadowDepth="0" Opacity="0.6"/>
                        </Ellipse.Effect>
                    </Ellipse>
                    <TextBlock Text="R/" FontSize="24" FontWeight="Bold" Foreground="White" 
                               HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Grid>
                
                <!-- App name -->
                <TextBlock Text="R/StudioGPT" FontSize="32" FontWeight="Bold" Foreground="#a78bfa" 
                           HorizontalAlignment="Center" Margin="0,0,0,8">
                    <TextBlock.Effect>
                        <DropShadowEffect Color="#a78bfa" BlurRadius="20" ShadowDepth="0" Opacity="0.5"/>
                    </TextBlock.Effect>
                </TextBlock>
                
                <!-- Tagline -->
                <TextBlock Text="NARRATIVE INTELLIGENCE" FontSize="12" Foreground="#666680" 
                           HorizontalAlignment="Center" Margin="0,0,0,40" CharacterSpacing="150"/>
                
                <!-- Loading bar -->
                <Border Width="200" Height="4" CornerRadius="2" Background="#1a1a2e" ClipToBounds="True">
                    <Border Width="60" Height="4" CornerRadius="2" HorizontalAlignment="Left" x:Name="loadingBar">
                        <Border.Background>
                            <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                                <GradientStop Color="#6366f1" Offset="0"/>
                                <GradientStop Color="#a78bfa" Offset="1"/>
                            </LinearGradientBrush>
                        </Border.Background>
                    </Border>
                </Border>
                
                <!-- Loading text -->
                <TextBlock Text="Initializing..." FontSize="12" Foreground="#555566" 
                           HorizontalAlignment="Center" Margin="0,20,0,0" x:Name="loadingText"/>
            </StackPanel>
            
            <!-- Version -->
            <TextBlock Text="v1.0.0" FontSize="11" Foreground="#333344" 
                       HorizontalAlignment="Center" VerticalAlignment="Bottom" Margin="0,0,0,20"/>
        </Grid>
    </Border>
</Window>
"@

$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
$window = [Windows.Markup.XamlReader]::Load($reader)

# Get elements for animation
$ring1 = $window.FindName("ring1")
$ring2 = $window.FindName("ring2")
$ring3 = $window.FindName("ring3")
$loadingBar = $window.FindName("loadingBar")

# Create animations
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(16)
$angle1 = 0
$angle2 = 0
$angle3 = 0
$barPos = -60

$timer.Add_Tick({
    $angle1 = ($angle1 + 3) % 360
    $angle2 = ($angle2 - 4) % 360
    $angle3 = ($angle3 + 5) % 360
    $script:barPos = ($script:barPos + 3)
    if ($script:barPos -gt 200) { $script:barPos = -60 }
    
    $ring1.RenderTransform.Angle = $angle1
    $ring2.RenderTransform.Angle = $angle2
    $ring3.RenderTransform.Angle = $angle3
    $loadingBar.Margin = [System.Windows.Thickness]::new($script:barPos, 0, 0, 0)
})
$timer.Start()

$window.ShowDialog() | Out-Null
